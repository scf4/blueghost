import { config } from "./config";
import { handleProxyRequest } from "./app";

const tty = process.stdout.isTTY ?? false;
const dim = tty ? "\x1b[2m" : "";
const blue = tty ? "\x1b[34m\x1b[1m" : "";
const green = tty ? "\x1b[32m" : "";
const yellow = tty ? "\x1b[33m" : "";
const reset = tty ? "\x1b[0m" : "";

const proxyOrigin = `http://127.0.0.1:${config.port}`;
const pythonStatus = !config.enablePython
  ? `${dim}disabled${reset}`
  : config.pythonUpstreamVerified
    ? `${green}enabled${reset}`
    : `${yellow}enabled (unverified upstream will be blocked)${reset}`;

const lines = [
  "",
  `  ${blue}blueghost${reset}  ${dim}registry quarantine proxy${reset}`,
  "",
  `  ${dim}proxy${reset}      ${proxyOrigin}`,
  `  ${dim}quarantine${reset} ${config.quarantineHours}h`,
  `  ${dim}npm${reset}        ${config.npmUpstream}`,
  `  ${dim}python${reset}     ${pythonStatus}`,
  `  ${dim}pypi${reset}       ${config.pypiUpstream}`,
  "",
  `  ${dim}healthz${reset}    ${proxyOrigin}/healthz`,
  `  ${dim}npm/pnpm${reset}   ${proxyOrigin}`,
];

if (config.enablePython) {
  lines.push(`  ${dim}pip/uv${reset}     ${proxyOrigin}/simple/`);
}

lines.push("");

Bun.serve({
  port: config.port,
  hostname: "127.0.0.1",
  idleTimeout: 30,
  fetch: handleProxyRequest,
});

console.log(lines.join("\n"));
