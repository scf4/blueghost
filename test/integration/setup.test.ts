import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";

import {
  cleanupSetupFixtures,
  createFakeSetupEnvironment,
  readConfig,
  runSetup,
  seedConfig,
} from "../helpers/setup-fixture";

afterEach(() => {
  cleanupSetupFixtures();
});

test("setup.sh restores existing registry configuration on unset-defaults", () => {
  const env = createFakeSetupEnvironment();
  const bunfigPath = join(env.home, ".bunfig.toml");
  const bunfigOriginal =
    '[install]\ncache = true\nregistry = "https://bun.example"\n';

  writeFileSync(bunfigPath, bunfigOriginal);
  writeFileSync(
    join(env.home, ".zshrc"),
    'export UV_INDEX_URL="https://uv.example/simple/"\n',
  );

  seedConfig(env.stateDir, "npm", "registry", "https://npm.example");
  seedConfig(env.stateDir, "pnpm", "registry", "https://pnpm.example");
  seedConfig(env.stateDir, "yarn", "npmRegistryServer", "https://yarn.example");
  seedConfig(
    env.stateDir,
    "pip3",
    "global.index-url",
    "https://pip.example/simple/",
  );
  seedConfig(env.stateDir, "pip3", "global.trusted-host", "pip.example");

  runSetup(env, "set-defaults");

  expect(readConfig(env.stateDir, "npm", "registry")).toBe(
    "http://127.0.0.1:4873",
  );
  expect(readConfig(env.stateDir, "pnpm", "registry")).toBe(
    "http://127.0.0.1:4873",
  );
  expect(readConfig(env.stateDir, "yarn", "npmRegistryServer")).toBe(
    "http://127.0.0.1:4873",
  );
  expect(readConfig(env.stateDir, "pip3", "global.index-url")).toBe(
    "http://127.0.0.1:4873/simple/",
  );
  expect(readConfig(env.stateDir, "pip3", "global.trusted-host")).toBe(
    "127.0.0.1",
  );
  expect(readFileSync(bunfigPath, "utf8")).toContain(
    'registry = "http://127.0.0.1:4873"',
  );
  expect(readFileSync(join(env.home, ".zshrc"), "utf8")).toContain(
    "# blueghost",
  );

  runSetup(env, "unset-defaults");

  expect(readConfig(env.stateDir, "npm", "registry")).toBe(
    "https://npm.example",
  );
  expect(readConfig(env.stateDir, "pnpm", "registry")).toBe(
    "https://pnpm.example",
  );
  expect(readConfig(env.stateDir, "yarn", "npmRegistryServer")).toBe(
    "https://yarn.example",
  );
  expect(readConfig(env.stateDir, "pip3", "global.index-url")).toBe(
    "https://pip.example/simple/",
  );
  expect(readConfig(env.stateDir, "pip3", "global.trusted-host")).toBe(
    "pip.example",
  );
  expect(readFileSync(bunfigPath, "utf8")).toBe(bunfigOriginal);
  expect(readFileSync(join(env.home, ".zshrc"), "utf8")).toBe(
    'export UV_INDEX_URL="https://uv.example/simple/"\n',
  );
});

test("install persists custom upstream registries in the service definition", () => {
  const env = createFakeSetupEnvironment();

  runSetup(env, "install", {
    NPM_UPSTREAM: "https://mirror.example/npm",
    PYPI_UPSTREAM: "https://mirror.example/pypi",
  });

  const servicePath = process.platform === "darwin"
    ? join(env.home, "Library", "LaunchAgents", "com.blueghost.proxy.plist")
    : join(env.home, ".config", "systemd", "user", "blueghost.service");
  const service = readFileSync(servicePath, "utf8");

  expect(service).toContain("https://mirror.example/npm");
  expect(service).toContain("https://mirror.example/pypi");
});
