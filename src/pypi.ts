import { config, QUARANTINE_MS } from "./config";

/**
 * Handle requests destined for the PyPI Simple API.
 *
 * pip / uv / poetry all resolve packages via GET /simple/{package}/ which
 * returns an HTML page of download links.  We use the JSON API to get
 * upload timestamps and decide which versions to quarantine, then fetch the
 * real Simple HTML and strip links for quarantined files.  This preserves
 * all original attributes (PEP 658 metadata hints, data-yanked, etc.).
 *
 * File downloads go directly to files.pythonhosted.org (the URLs in the
 * HTML are absolute), so they never touch this proxy.
 */
export async function handlePypi(_req: Request, url: URL): Promise<Response> {
  // Index page (/simple/) – proxy straight through.
  const match = url.pathname.match(/^\/simple\/([^/]+)\/?$/);
  if (!match) {
    const res = await fetch(`${config.pypiUpstream}${url.pathname}${url.search}`, {
      signal: AbortSignal.timeout(15_000),
    });
    return new Response(res.body, {
      status: res.status,
      headers: { "Content-Type": "text/html" },
    });
  }

  const pkg = match[1];

  // ── Fetch JSON API for timestamps ─────────────────────────────────
  const jsonRes = await fetch(`${config.pypiUpstream}/pypi/${pkg}/json`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!jsonRes.ok) {
    log(pkg, `BLOCKED – JSON API returned ${jsonRes.status}, cannot verify version ages`);
    return new Response(`quarantine: cannot fetch version timestamps for ${pkg}`, { status: 502 });
  }

  const json = await jsonRes.json();
  const releases: Record<string, JsonFile[]> = json.releases || {};

  const now = Date.now();
  const quarantined: string[] = [];
  const blockedFiles = new Set<string>();
  let totalVersions = 0;

  for (const [version, files] of Object.entries(releases)) {
    if (!Array.isArray(files) || files.length === 0) continue;
    totalVersions++;

    // A version's age = its most recent file upload.
    const newest = Math.max(
      ...files.map((f) =>
        parseUTC(f.upload_time_iso_8601 || f.upload_time),
      ),
    );

    if (now - newest < QUARANTINE_MS) {
      quarantined.push(version);
      for (const f of files) blockedFiles.add(f.filename);
    }
  }

  // Nothing to filter, or everything is new (brand-new package) – pass through.
  if (quarantined.length === 0) {
    return proxySimple(pkg);
  }

  if (quarantined.length >= totalVersions) {
    log(pkg, "all versions newer than quarantine window – passing through");
    return proxySimple(pkg);
  }

  log(pkg, `quarantined ${quarantined.join(", ")}`);

  // ── Fetch real Simple HTML and strip quarantined file links ────────
  const html = await fetchSimpleHtml(pkg);
  if (html === null) {
    log(pkg, "BLOCKED – Simple API unavailable, cannot serve filtered page");
    return new Response(`quarantine: cannot fetch package page for ${pkg}`, { status: 502 });
  }

  const filtered = html
    .split("\n")
    .filter((line) => {
      const m = line.match(/>([^<]+)<\/a>/);
      return !m || !blockedFiles.has(m[1].trim());
    })
    .join("\n");

  // Fail-closed: verify no blocked filenames leaked through
  for (const filename of blockedFiles) {
    if (filtered.includes(`>${filename}<`)) {
      log(pkg, `BLOCKED – quarantined file "${filename}" survived filtering`);
      return new Response(`quarantine: filtering integrity check failed for ${pkg}`, { status: 502 });
    }
  }

  return new Response(filtered, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

// ── Helpers ───────────────────────────────────────────────────────────

interface JsonFile {
  filename: string;
  upload_time: string;
  upload_time_iso_8601?: string;
}

/** Fetch the real Simple API HTML from upstream, or null on failure. */
async function fetchSimpleHtml(pkg: string): Promise<string | null> {
  const res = await fetch(`${config.pypiUpstream}/simple/${pkg}/`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  return res.text();
}

/** Proxy the Simple API HTML straight through from upstream. */
async function proxySimple(pkg: string): Promise<Response> {
  const res = await fetch(`${config.pypiUpstream}/simple/${pkg}/`, {
    signal: AbortSignal.timeout(15_000),
  });
  return new Response(res.body, {
    status: res.status,
    headers: { "Content-Type": "text/html" },
  });
}

/** Parse a timestamp as UTC even if it lacks a timezone suffix. */
function parseUTC(raw: string): number {
  return new Date(raw.endsWith("Z") ? raw : raw + "Z").getTime();
}

function log(pkg: string, msg: string) {
  console.log(`[pypi] ${pkg}: ${msg}`);
}
