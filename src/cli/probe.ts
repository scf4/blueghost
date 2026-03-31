import { DEFAULT_PYPI_UPSTREAM } from "../config";

import type { PythonProbeResult } from "./types";

const PROBE_PACKAGE = "pip";

export async function probePythonUpstream(
  upstream: string,
): Promise<PythonProbeResult> {
  const base = normalizeUpstream(upstream);

  const simpleRes = await fetch(`${base}/simple/${PROBE_PACKAGE}/`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!simpleRes.ok) {
    return {
      ok: false,
      message: `Simple API probe failed with ${simpleRes.status}`,
    };
  }

  const jsonRes = await fetch(`${base}/pypi/${PROBE_PACKAGE}/json`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!jsonRes.ok) {
    return {
      ok: false,
      message: `metadata probe failed with ${jsonRes.status}`,
    };
  }

  const json = await jsonRes.json() as {
    releases?: Record<
      string,
      Array<{ upload_time?: string; upload_time_iso_8601?: string }>
    >;
  };

  const releases = json.releases || {};
  const hasTimestamp = Object.values(releases).some((files) =>
    files.some((file) => Boolean(file.upload_time || file.upload_time_iso_8601))
  );

  if (!hasTimestamp) {
    return {
      ok: false,
      message: "metadata probe returned no usable upload timestamps",
    };
  }

  return {
    ok: true,
    message:
      base === DEFAULT_PYPI_UPSTREAM
        ? "Python support verified against canonical PyPI"
        : "Python support verified against custom upstream",
  };
}

export function normalizeUpstream(raw: string): string {
  return raw.replace(/\/+$/, "");
}
