import { config } from "./config";
import { handleProxyRequest } from "./app";

const proxyOrigin = `http://127.0.0.1:${config.port}`;
const pythonStatus = !config.enablePython
  ? "disabled"
  : config.pythonUpstreamVerified
    ? "enabled"
    : "enabled (unverified upstream will be blocked)";

const lines = [
  "",
  "  blueghost",
  `  ├─ proxy:      ${proxyOrigin}`,
  `  ├─ quarantine: ${config.quarantineHours}h`,
  `  ├─ npm:        ${config.npmUpstream}`,
  `  ├─ python:     ${pythonStatus}`,
  `  └─ pypi:       ${config.pypiUpstream}`,
  "",
  `  healthz       → ${proxyOrigin}/healthz`,
  `  npm/bun/pnpm → ${proxyOrigin}`,
];

if (config.enablePython) {
  lines.push(`  pip/uv       → ${proxyOrigin}/simple/`);
}

lines.push("");

Bun.serve({
  port: config.port,
  hostname: "127.0.0.1",
  idleTimeout: 30,
  fetch: handleProxyRequest,
});

console.log(lines.join("\n"));
