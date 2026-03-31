import { afterEach, expect, test } from "bun:test";

import {
  filterSimpleHtml,
  findQuarantinedReleases,
  handlePypiRequest,
} from "../../../src/registry/pypi";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("findQuarantinedReleases blocks files from versions newer than the quarantine window", () => {
  const now = new Date("2026-04-01T12:00:00.000Z").getTime();
  const releases = {
    "1.0.0": [
      {
        filename: "demo-1.0.0.tar.gz",
        upload_time: "2026-03-25T00:00:00.000Z",
      },
    ],
    "1.1.0": [
      {
        filename: "demo-1.1.0.tar.gz",
        upload_time_iso_8601: "2026-04-01T04:00:00.000Z",
        upload_time: "2026-04-01T04:00:00.000Z",
      },
      {
        filename: "demo-1.1.0-py3-none-any.whl",
        upload_time_iso_8601: "2026-04-01T04:30:00.000Z",
        upload_time: "2026-04-01T04:30:00.000Z",
      },
    ],
  };

  const result = findQuarantinedReleases(releases, now);

  expect(result.quarantined).toEqual(["1.1.0"]);
  expect(result.totalVersions).toBe(2);
  expect(result.unverifiableVersions).toEqual([]);
  expect([...result.blockedFiles].sort()).toEqual([
    "demo-1.1.0-py3-none-any.whl",
    "demo-1.1.0.tar.gz",
  ]);
});

test("findQuarantinedReleases marks releases without timestamps as unverifiable", () => {
  const result = findQuarantinedReleases({
    "1.0.0": [
      {
        filename: "demo-1.0.0.tar.gz",
        upload_time: "2026-03-25T00:00:00.000Z",
      },
    ],
    "1.1.0": [
      {
        filename: "demo-1.1.0.tar.gz",
        upload_time: "",
      },
    ],
  });

  expect(result.unverifiableVersions).toEqual(["1.1.0"]);
});

test("filterSimpleHtml removes quarantined file links", () => {
  const html = [
    '<a href="https://files.pythonhosted.org/demo-1.0.0.tar.gz">demo-1.0.0.tar.gz</a>',
    '<a href="https://files.pythonhosted.org/demo-1.1.0.tar.gz">demo-1.1.0.tar.gz</a>',
  ].join("\n");

  const filtered = filterSimpleHtml(html, new Set(["demo-1.1.0.tar.gz"]));

  expect(filtered).toContain("demo-1.0.0.tar.gz");
  expect(filtered).not.toContain("demo-1.1.0.tar.gz");
});

test("handlePypiRequest preserves upstream 404s for missing packages", async () => {
  const calls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);

    if (url.endsWith("/pypi/missing/json")) {
      return new Response('{"message":"Not Found"}', {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.endsWith("/simple/missing/")) {
      return new Response("404 Not Found", {
        status: 404,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;

  const url = new URL("http://127.0.0.1:4873/simple/missing/");
  const res = await handlePypiRequest(new Request(url), url);

  expect(res.status).toBe(404);
  expect(await res.text()).toBe("404 Not Found");
  expect(calls).toEqual([
    "https://pypi.org/pypi/missing/json",
    "https://pypi.org/simple/missing/",
  ]);
});

test("handlePypiRequest strips quarantined file links from simple pages", async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.endsWith("/pypi/demo/json")) {
      return Response.json({
        releases: {
          "1.0.0": [
            {
              filename: "demo-1.0.0.tar.gz",
              upload_time: "2026-03-25T00:00:00.000Z",
            },
          ],
          "1.1.0": [
            {
              filename: "demo-1.1.0.tar.gz",
              upload_time_iso_8601: "2026-04-01T04:00:00.000Z",
              upload_time: "2026-04-01T04:00:00.000Z",
            },
          ],
        },
      });
    }

    if (url.endsWith("/simple/demo/")) {
      return new Response(
        [
          '<a href="https://files.pythonhosted.org/demo-1.0.0.tar.gz">demo-1.0.0.tar.gz</a>',
          '<a href="https://files.pythonhosted.org/demo-1.1.0.tar.gz">demo-1.1.0.tar.gz</a>',
        ].join("\n"),
        {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        },
      );
    }

    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;

  const realNow = Date.now;
  Date.now = () => new Date("2026-04-01T12:00:00.000Z").getTime();

  try {
    const url = new URL("http://127.0.0.1:4873/simple/demo/");
    const res = await handlePypiRequest(new Request(url), url);
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain("demo-1.0.0.tar.gz");
    expect(html).not.toContain("demo-1.1.0.tar.gz");
  } finally {
    Date.now = realNow;
  }
});

test("handlePypiRequest fails closed when a release lacks upload timestamps", async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.endsWith("/pypi/demo/json")) {
      return Response.json({
        releases: {
          "1.0.0": [
            {
              filename: "demo-1.0.0.tar.gz",
              upload_time: "2026-03-25T00:00:00.000Z",
            },
          ],
          "1.1.0": [
            {
              filename: "demo-1.1.0.tar.gz",
              upload_time: "",
            },
          ],
        },
      });
    }

    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;

  const url = new URL("http://127.0.0.1:4873/simple/demo/");
  const res = await handlePypiRequest(new Request(url), url);

  expect(res.status).toBe(502);
  expect(await res.text()).toContain("cannot verify version timestamps");
});
