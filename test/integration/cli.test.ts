import { afterEach, expect, test } from "bun:test";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  cleanupSetupFixtures,
  createFakeSetupEnvironment,
  readConfig,
  readSetupRecord,
  runCli,
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
  expect(status.stdout).toContain("Python: enabled (verified)");
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

function readServiceFile(env: ReturnType<typeof createFakeSetupEnvironment>) {
  const path = process.platform === "darwin"
    ? join(env.home, "Library", "LaunchAgents", "com.blueghost.proxy.plist")
    : join(env.home, ".config", "systemd", "user", "blueghost.service");
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}
