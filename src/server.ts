import { config } from "./config";
import { handleNpm } from "./npm";
import { handlePypi } from "./pypi";

const server = Bun.serve({
  port: config.port,
  hostname: "127.0.0.1",
  idleTimeout: 30,
  async fetch(req) {
    const url = new URL(req.url);

    try {
      // /simple/* → PyPI Simple API
      if (url.pathname === "/simple" || url.pathname.startsWith("/simple/")) {
        return await handlePypi(req, url);
      }

      // Everything else → npm registry
      return await handleNpm(req, url);
    } catch (err) {
      console.error(`[error] ${url.pathname}:`, err);
      return new Response("upstream error", { status: 502 });
    }
  },
});

console.log(
  [
    "",
    "  blueghost",
    `  ├─ proxy:      http://localhost:${server.port}`,
    `  ├─ quarantine: ${config.quarantineHours}h`,
    `  ├─ npm:        ${config.npmUpstream}`,
    `  └─ pypi:       ${config.pypiUpstream}`,
    "",
    `  npm/bun/pnpm → http://localhost:${server.port}`,
    `  pip/uv       → http://localhost:${server.port}/simple/`,
    "",
  ].join("\n"),
);
