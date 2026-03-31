import { config } from "./config";
import { handleProxyRequest } from "./app";

const proxyOrigin = `http://127.0.0.1:${config.port}`;

Bun.serve({
  port: config.port,
  hostname: "127.0.0.1",
  idleTimeout: 30,
  fetch: handleProxyRequest,
});

console.log(
  [
    "",
    "  blueghost",
    `  ├─ proxy:      ${proxyOrigin}`,
    `  ├─ quarantine: ${config.quarantineHours}h`,
    `  ├─ npm:        ${config.npmUpstream}`,
    `  └─ pypi:       ${config.pypiUpstream}`,
    "",
    `  npm/bun/pnpm → ${proxyOrigin}`,
    `  pip/uv       → ${proxyOrigin}/simple/`,
    "",
  ].join("\n"),
);
