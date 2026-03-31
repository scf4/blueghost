import { config, QUARANTINE_MS } from "./config";

/**
 * Handle requests destined for the npm registry.
 *
 * Metadata requests (GET /:package) are intercepted: any version published
 * less than QUARANTINE_MS ago is stripped from the response so the package
 * manager never even sees it.  If *every* version is younger than the
 * threshold the package is brand-new and we let it through unchanged.
 *
 * Tarball requests (containing /-/) are proxied straight to upstream.
 */
export async function handleNpm(req: Request, url: URL): Promise<Response> {
  const upstream = `${config.npmUpstream}${url.pathname}${url.search}`;

  // Non-GET requests (publish, login, etc.) – pass through to upstream.
  if (req.method !== "GET") {
    return fetch(upstream, {
      method: req.method,
      headers: req.headers,
      body: req.body,
      signal: AbortSignal.timeout(15_000),
    });
  }

  // ── Tarball downloads – pass through ──────────────────────────────
  if (url.pathname.includes("/-/")) {
    const res = await fetch(upstream, { signal: AbortSignal.timeout(15_000) });
    return new Response(res.body, {
      status: res.status,
      headers: {
        "Content-Type":
          res.headers.get("Content-Type") || "application/octet-stream",
      },
    });
  }

  // ── Package metadata ──────────────────────────────────────────────
  const res = await fetch(upstream, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) return new Response(res.body, { status: res.status });

  const meta = await res.json();

  // If there's no time map we can't filter – pass through.
  if (!meta.time || !meta.versions) return Response.json(meta);

  const now = Date.now();
  const quarantined: string[] = [];
  const versionKeys = Object.keys(meta.versions);

  for (const [version, timestamp] of Object.entries(meta.time)) {
    if (version === "created" || version === "modified") continue;
    if (!meta.versions[version]) continue;
    if (now - new Date(timestamp as string).getTime() < QUARANTINE_MS) {
      quarantined.push(version);
    }
  }

  // Nothing to filter, or everything is new (brand-new package) – pass through.
  if (quarantined.length === 0) return Response.json(meta);
  if (quarantined.length >= versionKeys.length) {
    log(meta.name, "all versions newer than quarantine window – passing through");
    return Response.json(meta);
  }

  // ── Strip quarantined versions ────────────────────────────────────
  for (const v of quarantined) {
    delete meta.versions[v];
    delete meta.time[v];
  }

  log(meta.name, `quarantined ${quarantined.join(", ")}`);

  // ── Fix dist-tags so they point to surviving versions ─────────────
  const surviving = new Set(Object.keys(meta.versions));

  if (meta["dist-tags"]) {
    for (const tag of Object.keys(meta["dist-tags"])) {
      if (!surviving.has(meta["dist-tags"][tag])) {
        meta["dist-tags"][tag] = newestSurviving(meta.time, surviving);
      }
    }
  }

  return Response.json(meta);
}

// ── Helpers ───────────────────────────────────────────────────────────

/** Find the surviving version with the most recent publish timestamp. */
function newestSurviving(
  time: Record<string, string>,
  surviving: Set<string>,
): string {
  let best = "";
  let bestTime = 0;
  for (const v of surviving) {
    const raw = time[v];
    if (!raw) continue;
    const t = new Date(raw).getTime();
    if (t > bestTime) {
      bestTime = t;
      best = v;
    }
  }
  // If nothing had a valid timestamp, pick any surviving version
  // rather than returning "" which would corrupt dist-tags
  if (!best && surviving.size > 0) {
    best = surviving.values().next().value!;
  }
  return best;
}

function log(pkg: string, msg: string) {
  console.log(`[npm] ${pkg}: ${msg}`);
}
