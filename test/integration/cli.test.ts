import { afterEach, expect, test } from "bun:test";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  cleanupSetupFixtures,
  createFakeSetupEnvironment,
  overwriteCommand,
  readConfig,
  readPendingSetupRecord,
  readSetupRecord,
  seedConfig,
  runCli,
  runCliRaw,
} from "../helpers/setup-fixture";

const servers: Array<{ close: () => void }> = [];

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.close();
  }
  cleanupSetupFixtures();
});

test("cli setup enables JS by default and leaves Python disabled by default", () => {
  const env = createFakeSetupEnvironment();
  runCli(env, ["setup"], "\n\n\n\n\n");

  const record = readSetupRecord(env);
  const service = readServiceFile(env);

  expect(record.ecosystems.js).toBeTrue();
  expect(record.ecosystems.python).toBeFalse();
  expect(readConfig(env.stateDir, "npm", "registry")).toBe("http://127.0.0.1:4873");
  expect(readConfig(env.stateDir, "pip3", "global.index-url")).toBeNull();
  expect(service).toContain("ENABLE_PYTHON");
  expect(service).toContain("0");
});

test("cli setup disables Python when a custom upstream fails capability probing", () => {
  const env = createFakeSetupEnvironment();
  const upstream = startHttpFixture((req, res) => {
    if (req.url === "/simple/pip/") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html></html>");
      return;
    }

    if (req.url === "/pypi/pip/json") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end('{"message":"not found"}');
      return;
    }

    res.writeHead(404);
    res.end("missing");
  });

  const result = runCli(
    env,
    ["setup"],
    `\ny\n\n\n\n${upstream}\n`,
  );

  const record = readSetupRecord(env);

  expect(result.stdout).toContain("Python support disabled");
  expect(record.ecosystems.js).toBeTrue();
  expect(record.ecosystems.python).toBeFalse();
  expect(record.python.verified).toBeFalse();
  expect(readConfig(env.stateDir, "pip3", "global.index-url")).toBeNull();
});

test("cli setup enables Python for a verified custom upstream and status reports it", () => {
  const env = createFakeSetupEnvironment();
  const upstream = startHttpFixture((req, res) => {
    if (req.url === "/simple/pip/") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html><body>ok</body></html>");
      return;
    }

    if (req.url === "/pypi/pip/json") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          releases: {
            "1.0.0": [
              {
                upload_time: "2026-03-25T00:00:00.000Z",
              },
            ],
          },
        }),
      );
      return;
    }

    res.writeHead(404);
    res.end("missing");
  });

  runCli(env, ["setup"], `\ny\n\n\n\n${upstream}\n`);
  const status = runCli(env, ["status"]);
  const record = readSetupRecord(env);

  expect(record.ecosystems.python).toBeTrue();
  expect(record.python.verified).toBeTrue();
  expect(record.upstreams.pypi).toBe(upstream);
  expect(readConfig(env.stateDir, "pip3", "global.index-url")).toBe(
    "http://127.0.0.1:4873/simple/",
  );
  expect(status.stdout).toContain("Python");
  expect(status.stdout).toContain("enabled (verified)");
});

test("cli setup rerun restores Python managers when Python is disabled", () => {
  const env = createFakeSetupEnvironment();
  const upstream = startVerifiedFixture();
  seedPythonDefaults(env);

  runCli(env, ["setup"], `\ny\n\n\n\n${upstream}\n`);
  runCli(env, ["setup"], "\nn\n\n\n\n");

  const record = readSetupRecord(env);

  expect(record.ecosystems.python).toBeFalse();
  expect(readConfig(env.stateDir, "pip3", "global.index-url")).toBe(
    "https://pip.example/simple/",
  );
  expect(readConfig(env.stateDir, "pip3", "global.trusted-host")).toBe(
    "pip.example",
  );
  expect(readFileSync(join(env.home, ".zshrc"), "utf8")).toBe(
    'export UV_INDEX_URL="https://uv.example/simple/"\n',
  );
});

test("cli setup rerun restores JS managers when JS is disabled", () => {
  const env = createFakeSetupEnvironment();
  const upstream = startVerifiedFixture();
  seedJsDefaults(env);

  runCli(env, ["setup"], `\ny\n\n\n\n${upstream}\n`);
  runCli(env, ["setup"], "n\n\n\n\n");

  const record = readSetupRecord(env);

  expect(record.ecosystems.js).toBeFalse();
  expect(record.ecosystems.python).toBeTrue();
  expect(readConfig(env.stateDir, "npm", "registry")).toBe("https://npm.example");
  expect(readConfig(env.stateDir, "pnpm", "registry")).toBe("https://pnpm.example");
  expect(readConfig(env.stateDir, "yarn", "npmRegistryServer")).toBe("https://yarn.example");
  expect(readFileSync(join(env.home, ".bunfig.toml"), "utf8")).toBe(
    '[install]\ncache = true\nregistry = "https://bun.example"\n',
  );
  expect(readConfig(env.stateDir, "pip3", "global.index-url")).toBe(
    "http://127.0.0.1:4873/simple/",
  );
});

test("cli uninstall restores config after a first-run setup failure", () => {
  const env = createFakeSetupEnvironment();
  seedConfig(env.stateDir, "npm", "registry", "https://npm.example");
  overwriteCommand(
    env,
    "pnpm",
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "config" && "\${2:-}" == "get" ]]; then
  echo "https://pnpm.example"
  exit 0
fi
if [[ "\${1:-}" == "config" && "\${2:-}" == "set" ]]; then
  echo "pnpm failed" >&2
  exit 1
fi
exit 0
`,
  );

  const result = runCliRaw(env, ["setup"], "\n\n\n\n\n");
  expect(result.status).not.toBe(0);
  expect(readConfig(env.stateDir, "npm", "registry")).toBe("http://127.0.0.1:4873");
  expect(readPendingSetupRecord(env)).not.toBeNull();

  overwriteCommand(
    env,
    "pnpm",
    `#!/usr/bin/env bash
set -euo pipefail
state_dir="\${FAKE_STATE_DIR:?}"
store_prefix="\${state_dir}/\${0##*/}"
mkdir -p "\${state_dir}"
if [[ "\${1:-}" != "config" ]]; then
  echo "unsupported command" >&2
  exit 1
fi
action="\${2:-}"
key="\${3:-}"
safe_key="\${key//\\//_}"
safe_key="\${safe_key// /_}"
file="\${store_prefix}.\${safe_key}"
case "\${action}" in
  get)
    if [[ -f "\${file}" ]]; then
      cat "\${file}"
    else
      echo "undefined"
    fi
    ;;
  set)
    printf '%s' "\${4:-}" > "\${file}"
    ;;
  delete|unset)
    rm -f "\${file}"
    ;;
  *)
    echo "unsupported config action" >&2
    exit 1
    ;;
esac
`,
  );

  runCli(env, ["uninstall"]);

  expect(readConfig(env.stateDir, "npm", "registry")).toBe("https://npm.example");
  expect(readPendingSetupRecord(env)).toBeNull();
});

test("cli setup auto-recovers from a previous failed setup run", () => {
  const env = createFakeSetupEnvironment();
  seedConfig(env.stateDir, "npm", "registry", "https://npm.example");
  overwriteCommand(
    env,
    "pnpm",
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "config" && "\${2:-}" == "get" ]]; then
  echo "https://pnpm.example"
  exit 0
fi
if [[ "\${1:-}" == "config" && "\${2:-}" == "set" ]]; then
  echo "pnpm failed" >&2
  exit 1
fi
exit 0
`,
  );

  const failed = runCliRaw(env, ["setup"], "\n\n\n\n\n");
  expect(failed.status).not.toBe(0);
  expect(readPendingSetupRecord(env)).not.toBeNull();

  // Fix pnpm and re-run setup — should auto-recover from pending state
  overwriteCommand(
    env,
    "pnpm",
    `#!/usr/bin/env bash
set -euo pipefail
state_dir="\${FAKE_STATE_DIR:?}"
store_prefix="\${state_dir}/\${0##*/}"
mkdir -p "\${state_dir}"
if [[ "\${1:-}" != "config" ]]; then
  echo "unsupported command" >&2
  exit 1
fi
action="\${2:-}"
key="\${3:-}"
safe_key="\${key//\\//_}"
safe_key="\${safe_key// /_}"
file="\${store_prefix}.\${safe_key}"
case "\${action}" in
  get)
    if [[ -f "\${file}" ]]; then
      cat "\${file}"
    else
      echo "undefined"
    fi
    ;;
  set)
    printf '%s' "\${4:-}" > "\${file}"
    ;;
  delete|unset)
    rm -f "\${file}"
    ;;
  *)
    echo "unsupported config action" >&2
    exit 1
    ;;
esac
`,
  );

  const result = runCli(env, ["setup"], "\n\n\n\n\n");
  expect(result.stdout).toContain("Recovering from incomplete previous setup");

  const record = readSetupRecord(env);
  expect(record.ecosystems.js).toBeTrue();
  expect(readPendingSetupRecord(env)).toBeNull();
  expect(readConfig(env.stateDir, "npm", "registry")).toBe("http://127.0.0.1:4873");
  expect(readConfig(env.stateDir, "pnpm", "registry")).toBe("http://127.0.0.1:4873");
});

function startHttpFixture(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): string {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to get fixture server address");
  }

  return `http://127.0.0.1:${address.port}`;
}

function startVerifiedFixture(): string {
  return startHttpFixture((req, res) => {
    if (req.url === "/simple/pip/") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html><body>ok</body></html>");
      return;
    }

    if (req.url === "/pypi/pip/json") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          releases: {
            "1.0.0": [
              {
                upload_time: "2026-03-25T00:00:00.000Z",
              },
            ],
          },
        }),
      );
      return;
    }

    res.writeHead(404);
    res.end("missing");
  });
}

function seedPythonDefaults(env: ReturnType<typeof createFakeSetupEnvironment>) {
  seedConfig(
    env.stateDir,
    "pip3",
    "global.index-url",
    "https://pip.example/simple/",
  );
  seedConfig(env.stateDir, "pip3", "global.trusted-host", "pip.example");
  writeFileSync(join(env.home, ".zshrc"), 'export UV_INDEX_URL="https://uv.example/simple/"\n');
}

function seedJsDefaults(env: ReturnType<typeof createFakeSetupEnvironment>) {
  writeFileSync(
    join(env.home, ".bunfig.toml"),
    '[install]\ncache = true\nregistry = "https://bun.example"\n',
  );
  seedConfig(env.stateDir, "npm", "registry", "https://npm.example");
  seedConfig(env.stateDir, "pnpm", "registry", "https://pnpm.example");
  seedConfig(env.stateDir, "yarn", "npmRegistryServer", "https://yarn.example");
}

function readServiceFile(env: ReturnType<typeof createFakeSetupEnvironment>) {
  const path = process.platform === "darwin"
    ? join(env.home, "Library", "LaunchAgents", "com.blueghost.proxy.plist")
    : join(env.home, ".config", "systemd", "user", "blueghost.service");
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}
