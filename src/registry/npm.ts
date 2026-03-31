import { config, QUARANTINE_MS } from "../config";
import { fetchUpstream, relayResponse } from "../lib/http";

interface NpmMetadata {
  name?: string;
  versions?: Record<string, unknown>;
  time?: Record<string, string>;
  "dist-tags"?: Record<string, string>;
}

/**
 * Handle requests destined for the npm registry.
 *
 * Metadata requests (GET /:package) are intercepted: any version published
 * less than QUARANTINE_MS ago is stripped from the response so the package
 * manager never even sees it. If every version is younger than the threshold,
 * the package is brand-new and we let it through unchanged.
 *
 * Tarball requests (containing /-/) are proxied straight to upstream.
 */
export async function handleNpmRequest(
  req: Request,
  url: URL,
): Promise<Response> {
  const upstream = `${config.npmUpstream}${url.pathname}${url.search}`;

  if (req.method !== "GET") {
    return fetchUpstream(upstream, {
      method: req.method,
      headers: req.headers,
      body: req.body,
    });
  }

  if (url.pathname.includes("/-/")) {
    const res = await fetchUpstream(upstream);
    return relayResponse(res, {
      defaultContentType: "application/octet-stream",
    });
  }

  const res = await fetchUpstream(upstream, {
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    return relayResponse(res);
  }

  const meta = await res.json() as NpmMetadata;

  if (!meta.time || !meta.versions) {
    return Response.json(meta);
  }

  const { quarantined, allVersionsQuarantined } = filterNpmMetadata(meta);

  if (quarantined.length === 0) {
    return Response.json(meta);
  }

  if (allVersionsQuarantined) {
    log(meta.name, "all versions newer than quarantine window - passing through");
    return Response.json(meta);
  }

  log(meta.name, `quarantined ${quarantined.join(", ")}`);
  return Response.json(meta);
}

export function filterNpmMetadata(
  meta: NpmMetadata,
  now = Date.now(),
): { quarantined: string[]; allVersionsQuarantined: boolean } {
  if (!meta.time || !meta.versions) {
    return { quarantined: [], allVersionsQuarantined: false };
  }

  const quarantined: string[] = [];
  const versionKeys = Object.keys(meta.versions);

  for (const [version, timestamp] of Object.entries(meta.time)) {
    if (version === "created" || version === "modified") continue;
    if (!meta.versions[version]) continue;

    const publishedAt = new Date(timestamp).getTime();
    if (Number.isFinite(publishedAt) && now - publishedAt < QUARANTINE_MS) {
      quarantined.push(version);
    }
  }

  if (quarantined.length === 0) {
    return { quarantined, allVersionsQuarantined: false };
  }

  if (quarantined.length >= versionKeys.length) {
    return { quarantined, allVersionsQuarantined: true };
  }

  for (const version of quarantined) {
    delete meta.versions[version];
    delete meta.time[version];
  }

  rewriteDistTags(
    meta["dist-tags"],
    meta.time,
    new Set(Object.keys(meta.versions)),
  );

  return { quarantined, allVersionsQuarantined: false };
}

function rewriteDistTags(
  distTags: Record<string, string> | undefined,
  time: Record<string, string>,
  surviving: Set<string>,
) {
  if (!distTags) return;

  for (const [tag, current] of Object.entries(distTags)) {
    if (surviving.has(current)) continue;

    const replacement = replacementForTag(tag, current, time, surviving);
    if (replacement) {
      distTags[tag] = replacement;
    } else {
      delete distTags[tag];
    }
  }
}

function newestSurviving(
  time: Record<string, string>,
  surviving: Set<string>,
  predicate: (version: string) => boolean = () => true,
): string {
  let best = "";
  let bestTime = 0;

  for (const version of surviving) {
    if (!predicate(version)) continue;

    const raw = time[version];
    if (!raw) continue;

    const publishedAt = new Date(raw).getTime();
    if (!Number.isFinite(publishedAt)) continue;

    if (publishedAt > bestTime) {
      bestTime = publishedAt;
      best = version;
    }
  }

  if (!best && surviving.size > 0) {
    best = surviving.values().next().value!;
  }

  return best;
}

function replacementForTag(
  tag: string,
  current: string,
  time: Record<string, string>,
  surviving: Set<string>,
): string {
  const family = prereleaseFamily(current);

  if (family) {
    const familyMatch = newestSurviving(time, surviving, (version) =>
      prereleaseFamily(version) === family,
    );
    if (familyMatch) return familyMatch;
  }

  if (tag === "latest") {
    const newestStable = newestSurviving(time, surviving, (version) =>
      prereleaseFamily(version) === null,
    );
    if (newestStable) return newestStable;
  }

  return newestSurviving(time, surviving);
}

function prereleaseFamily(version: string): string | null {
  const prerelease = version.split("-", 2)[1];
  if (!prerelease) return null;

  for (const token of prerelease.split(/[.-]/)) {
    if (token && !/^\d+$/.test(token)) {
      return token.toLowerCase();
    }
  }

  return null;
}

function log(pkg: string | undefined, msg: string) {
  console.log(`[npm] ${pkg || "unknown-package"}: ${msg}`);
}
