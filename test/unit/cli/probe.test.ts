import { afterEach, expect, test } from "bun:test";

import { probePythonUpstream } from "../../../src/cli/probe";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("probePythonUpstream succeeds when simple and metadata APIs are available", async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.endsWith("/simple/pip/")) {
      return new Response("<html></html>", { status: 200 });
    }

    if (url.endsWith("/pypi/pip/json")) {
      return Response.json({
        releases: {
          "1.0.0": [
            {
              upload_time: "2026-03-25T00:00:00.000Z",
            },
          ],
        },
      });
    }

    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;

  const result = await probePythonUpstream("https://mirror.example/pypi");

  expect(result.ok).toBeTrue();
});

test("probePythonUpstream fails when metadata API is unavailable", async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.endsWith("/simple/pip/")) {
      return new Response("<html></html>", { status: 200 });
    }

    if (url.endsWith("/pypi/pip/json")) {
      return new Response("not found", { status: 404 });
    }

    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;

  const result = await probePythonUpstream("https://mirror.example/pypi");

  expect(result.ok).toBeFalse();
  expect(result.message).toContain("metadata API probe failed");
});

test("probePythonUpstream fails when release entries lack upload timestamps", async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.endsWith("/simple/pip/")) {
      return new Response("<html></html>", { status: 200 });
    }

    if (url.endsWith("/pypi/pip/json")) {
      return Response.json({
        releases: {
          "1.0.0": [
            {
              upload_time: "2026-03-25T00:00:00.000Z",
            },
          ],
          "1.1.0": [
            {},
          ],
        },
      });
    }

    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;

  const result = await probePythonUpstream("https://mirror.example/pypi");

  expect(result.ok).toBeFalse();
  expect(result.message).toContain("upload timestamps");
});

test("probePythonUpstream returns a clean error when the upstream is unreachable", async () => {
  globalThis.fetch = (async () => {
    throw new Error("connect ECONNREFUSED 127.0.0.1:12345");
  }) as unknown as typeof fetch;

  const result = await probePythonUpstream("https://mirror.example/pypi");

  expect(result.ok).toBeFalse();
  expect(result.message).toContain("probe failed");
});

test("probePythonUpstream returns a clean error when metadata API returns invalid JSON", async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.endsWith("/simple/pip/")) {
      return new Response("<html></html>", { status: 200 });
    }

    if (url.endsWith("/pypi/pip/json")) {
      return new Response("this is not json", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;

  const result = await probePythonUpstream("https://mirror.example/pypi");

  expect(result.ok).toBeFalse();
  expect(result.message).toContain("invalid JSON");
});
