import {
  config,
  DEFAULT_PYPI_UPSTREAM,
  QUARANTINE_MS,
} from "../config";
import { fetchUpstream, relayResponse } from "../lib/http";

const SIMPLE_PACKAGE_PATTERN = /^\/simple\/([^/]+)\/?$/;

interface JsonFile {
  filename: string;
  upload_time: string;
  upload_time_iso_8601?: string;
}

type ReleaseMap = Record<string, JsonFile[]>;

export function isPypiPath(pathname: string): boolean {
  return pathname === "/simple" || pathname.startsWith("/simple/");
}

/**
 * Handle requests destined for the PyPI Simple API.
 *
 * pip / uv / poetry all resolve packages via GET /simple/{package}/ which
 * returns an HTML page of download links. We use the JSON API to get upload
 * timestamps and decide which versions to quarantine, then fetch the real
 * Simple HTML and strip links for quarantined files. This preserves original
 * link attributes such as PEP 658 metadata hints and yanked markers.
 *
 * File downloads go directly to files.pythonhosted.org because the URLs in the
 * HTML are absolute, so they never touch this proxy.
 */
export async function handlePypiRequest(
  _req: Request,
  url: URL,
): Promise<Response> {
  if (
    config.pypiUpstream !== DEFAULT_PYPI_UPSTREAM &&
    !config.pythonUpstreamVerified
  ) {
    return new Response(
      "python support is unavailable for an unverified upstream",
      { status: 503 },
    );
  }

  const pkg = parseSimplePackagePath(url.pathname);

  if (!pkg) {
    const res = await fetchUpstream(
      `${config.pypiUpstream}${url.pathname}${url.search}`,
    );
    return relayResponse(res, {
      defaultContentType: "text/html; charset=utf-8",
    });
  }

  // v1 depends on the PyPI JSON API releases field for timestamp data.
  // If that field disappears, migrate Python timestamp extraction to the
  // Simple API surface, preferably via PEP 700 data-upload-time.
  const jsonRes = await fetchUpstream(`${config.pypiUpstream}/pypi/${pkg}/json`);

  if (jsonRes.status === 404) {
    return proxySimple(pkg);
  }

  if (!jsonRes.ok) {
    log(
      pkg,
      `BLOCKED - JSON API returned ${jsonRes.status}, cannot verify version ages`,
    );
    return new Response(
      `quarantine: cannot fetch version timestamps for ${pkg}`,
      { status: 502 },
    );
  }

  const json = await jsonRes.json();
  const releases = (json.releases || {}) as ReleaseMap;
  const { quarantined, blockedFiles, totalVersions } =
    findQuarantinedReleases(releases);

  if (quarantined.length === 0) {
    return proxySimple(pkg);
  }

  if (quarantined.length >= totalVersions) {
    log(pkg, "all versions newer than quarantine window - passing through");
    return proxySimple(pkg);
  }

  log(pkg, `quarantined ${quarantined.join(", ")}`);

  const simpleRes = await fetchSimple(pkg);
  if (!simpleRes.ok) {
    return relayResponse(simpleRes, {
      defaultContentType: "text/html; charset=utf-8",
    });
  }

  const html = await simpleRes.text();
  const filtered = filterSimpleHtml(html, blockedFiles);

  if (filtered === null) {
    log(pkg, "BLOCKED - quarantined file survived filtering");
    return new Response(
      `quarantine: filtering integrity check failed for ${pkg}`,
      { status: 502 },
    );
  }

  return new Response(filtered, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export function findQuarantinedReleases(
  releases: ReleaseMap,
  now = Date.now(),
): { quarantined: string[]; blockedFiles: Set<string>; totalVersions: number } {
  const quarantined: string[] = [];
  const blockedFiles = new Set<string>();
  let totalVersions = 0;

  for (const [version, files] of Object.entries(releases)) {
    if (!Array.isArray(files) || files.length === 0) continue;
    totalVersions++;

    const uploads = files
      .map((file) => parseUTC(file.upload_time_iso_8601 || file.upload_time))
      .filter(Number.isFinite);

    if (uploads.length === 0) continue;

    const newest = Math.max(...uploads);
    if (now - newest < QUARANTINE_MS) {
      quarantined.push(version);
      for (const file of files) {
        blockedFiles.add(file.filename);
      }
    }
  }

  return { quarantined, blockedFiles, totalVersions };
}

export function filterSimpleHtml(
  html: string,
  blockedFiles: Set<string>,
): string | null {
  const filtered = html
    .split("\n")
    .filter((line) => {
      const match = line.match(/>([^<]+)<\/a>/);
      return !match || !blockedFiles.has(match[1].trim());
    })
    .join("\n");

  for (const filename of blockedFiles) {
    if (filtered.includes(`>${filename}<`)) {
      return null;
    }
  }

  return filtered;
}

function parseSimplePackagePath(pathname: string): string | null {
  return pathname.match(SIMPLE_PACKAGE_PATTERN)?.[1] ?? null;
}

function fetchSimple(pkg: string): Promise<Response> {
  return fetchUpstream(`${config.pypiUpstream}/simple/${pkg}/`);
}

function proxySimple(pkg: string): Promise<Response> {
  return fetchSimple(pkg).then((res) =>
    relayResponse(res, {
      defaultContentType: "text/html; charset=utf-8",
    })
  );
}

function parseUTC(raw: string): number {
  return new Date(raw.endsWith("Z") ? raw : `${raw}Z`).getTime();
}

function log(pkg: string, msg: string) {
  console.log(`[pypi] ${pkg}: ${msg}`);
}
