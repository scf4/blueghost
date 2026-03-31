import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runCommand } from "../../../src/cli/shell";

const tempDirs: string[] = [];
const originalHome = process.env.HOME;

afterEach(() => {
  process.env.HOME = originalHome;
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("runCommand defaults to the user home directory instead of the repo cwd", () => {
  const home = mkdtempSync(join(tmpdir(), "blueghost-shell-"));
  tempDirs.push(home);
  process.env.HOME = home;

  const script = join(home, "print-pwd");
  writeFileSync(
    script,
    "#!/usr/bin/env bash\nset -euo pipefail\npwd\n",
  );
  chmodSync(script, 0o755);

  const result = runCommand(script, []);

  expect(result.status).toBe(0);
  expect(realpathSync(result.stdout)).toBe(realpathSync(home));
});
