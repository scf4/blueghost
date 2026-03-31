import { DEFAULT_PYPI_UPSTREAM } from "../config";

import type { PythonProbeResult } from "./types";

const PROBE_PACKAGE = "pip";

export async function probePythonUpstream(
  upstream: string,
): Promise<PythonProbeResult> {
  const base = normalizeUpstream(upstream);

  const simpleRes = await fetchProbe(
    `${base}/simple/${PROBE_PACKAGE}/`,
    "Simple API",
  );
  if (!simpleRes.ok) {
    return simpleRes.result;
  }

  const jsonRes = await fetchProbe(
    `${base}/pypi/${PROBE_PACKAGE}/json`,
    "metadata API",
  );
  if (!jsonRes.ok) {
    return jsonRes.result;
  }

  const json = await jsonRes.result.json() as {
    releases?: Record<
      string,
      Array<{ upload_time?: string; upload_time_iso_8601?: string }>
    >;
  };

  const releaseEntries = Object.entries(json.releases || {})
    .filter(([, files]) => Array.isArray(files) && files.length > 0);
  if (releaseEntries.length === 0) {
    return {
      ok: false,
      message: "metadata probe returned no release files",
    };
  }

  const missingTimestamps = releaseEntries.filter(([, files]) =>
    !files.some((file) => Boolean(file.upload_time || file.upload_time_iso_8601))
  );
  if (missingTimestamps.length > 0) {
    return {
      ok: false,
      message: "metadata probe returned releases without usable upload timestamps",
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

async function fetchProbe(
  url: string,
  label: string,
): Promise<
  | { ok: true; result: Response }
  | { ok: false; result: PythonProbeResult }
> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return {
        ok: false,
        result: {
          ok: false,
          message: `${label} probe failed with ${response.status}`,
        },
      };
    }

    return { ok: true, result: response };
  } catch (error) {
    return {
      ok: false,
      result: {
        ok: false,
        message: `${label} probe failed: ${toErrorMessage(error)}`,
      },
    };
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "request failed";
}
