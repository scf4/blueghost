import { expect, test } from "bun:test";

import { filterNpmMetadata } from "../../../src/registry/npm";

test("filterNpmMetadata preserves prerelease channels when retargeting dist-tags", () => {
  const now = new Date("2026-04-01T12:00:00.000Z").getTime();
  const meta = {
    versions: {
      "1.0.0": {},
      "1.0.1": {},
      "1.1.0-beta.1": {},
      "1.1.0-beta.2": {},
    },
    time: {
      created: "2026-01-01T00:00:00.000Z",
      modified: "2026-04-01T06:00:00.000Z",
      "1.0.0": "2026-03-20T00:00:00.000Z",
      "1.0.1": "2026-04-01T04:30:00.000Z",
      "1.1.0-beta.1": "2026-03-28T00:00:00.000Z",
      "1.1.0-beta.2": "2026-04-01T05:00:00.000Z",
    },
    "dist-tags": {
      latest: "1.0.1",
      beta: "1.1.0-beta.2",
    },
  };

  const result = filterNpmMetadata(meta, now);

  expect(result.quarantined.sort()).toEqual(["1.0.1", "1.1.0-beta.2"]);
  expect(result.allVersionsQuarantined).toBeFalse();
  expect(Object.keys(meta.versions).sort()).toEqual(["1.0.0", "1.1.0-beta.1"]);
  expect(meta["dist-tags"]).toEqual({
    latest: "1.0.0",
    beta: "1.1.0-beta.1",
  });
});

test("filterNpmMetadata passes through brand-new packages untouched", () => {
  const now = new Date("2026-04-01T12:00:00.000Z").getTime();
  const meta = {
    versions: {
      "0.1.0": {},
      "0.2.0": {},
    },
    time: {
      created: "2026-04-01T04:00:00.000Z",
      modified: "2026-04-01T06:00:00.000Z",
      "0.1.0": "2026-04-01T04:00:00.000Z",
      "0.2.0": "2026-04-01T06:00:00.000Z",
    },
    "dist-tags": {
      latest: "0.2.0",
    },
  };

  const result = filterNpmMetadata(meta, now);

  expect(result.quarantined.sort()).toEqual(["0.1.0", "0.2.0"]);
  expect(result.allVersionsQuarantined).toBeTrue();
  expect(Object.keys(meta.versions).sort()).toEqual(["0.1.0", "0.2.0"]);
  expect(meta["dist-tags"]).toEqual({ latest: "0.2.0" });
});
