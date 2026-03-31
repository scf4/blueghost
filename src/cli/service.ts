import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

import { runCommand } from "./shell";

export function installService(options: {
  port: number;
  quarantineHours: number;
  npmUpstream: string;
  pypiUpstream: string;
  enablePython: boolean;
  verifiedPypiUpstream: string;
}) {
  const bunPath = Bun.which("bun");
  if (!bunPath) {
    throw new Error("bun not found. Install it first: https://bun.sh");
  }

  const projectDir = fileURLToPath(new URL("../..", import.meta.url));
  const envLines = [
    ["QUARANTINE_HOURS", String(options.quarantineHours)],
    ["PORT", String(options.port)],
    ["NPM_UPSTREAM", options.npmUpstream],
    ["PYPI_UPSTREAM", options.pypiUpstream],
    ["ENABLE_PYTHON", options.enablePython ? "1" : "0"],
    ["VERIFIED_PYPI_UPSTREAM", options.verifiedPypiUpstream],
  ];

  if (process.platform === "darwin") {
    const plist = join(
      homedir(),
      "Library",
      "LaunchAgents",
      "com.blueghost.proxy.plist",
    );
    mkdirSync(dirname(plist), { recursive: true });
    writeFileSync(
      plist,
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.blueghost.proxy</string>
  <key>ProgramArguments</key>
  <array>
    <string>${bunPath}</string>
    <string>run</string>
    <string>${projectDir}/src/server.ts</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${envLines
  .map(
    ([key, value]) => `    <key>${key}</key>
    <string>${escapeXml(value)}</string>`,
  )
  .join("\n")}
  </dict>
  <key>KeepAlive</key>
  <true/>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/blueghost.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/blueghost.err</string>
</dict>
</plist>
`,
    );
    runCommand("launchctl", ["unload", plist]);
    runCommand("launchctl", ["load", plist]);
    runCommand("launchctl", ["start", "com.blueghost.proxy"]);
    return plist;
  }

  if (process.platform === "linux") {
    const unit = join(homedir(), ".config", "systemd", "user", "blueghost.service");
    mkdirSync(dirname(unit), { recursive: true });
    writeFileSync(
      unit,
      `[Unit]
Description=Package Registry Quarantine Proxy
After=network.target

[Service]
Type=simple
ExecStart=${bunPath} run ${projectDir}/src/server.ts
${envLines.map(([key, value]) => `Environment=${key}=${escapeSystemd(value)}`).join("\n")}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`,
    );
    runCommand("systemctl", ["--user", "daemon-reload"]);
    runCommand("systemctl", ["--user", "enable", "--now", "blueghost.service"]);
    return unit;
  }

  throw new Error(`unsupported platform: ${process.platform}`);
}

export function uninstallService() {
  if (process.platform === "darwin") {
    const plist = join(
      homedir(),
      "Library",
      "LaunchAgents",
      "com.blueghost.proxy.plist",
    );
    runCommand("launchctl", ["stop", "com.blueghost.proxy"]);
    runCommand("launchctl", ["unload", plist]);
    rmSync(plist, { force: true });
    return;
  }

  if (process.platform === "linux") {
    runCommand("systemctl", ["--user", "disable", "--now", "blueghost.service"]);
    rmSync(join(homedir(), ".config", "systemd", "user", "blueghost.service"), {
      force: true,
    });
    runCommand("systemctl", ["--user", "daemon-reload"]);
    return;
  }

  throw new Error(`unsupported platform: ${process.platform}`);
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function escapeSystemd(value: string): string {
  return value.replaceAll(" ", "\\x20");
}
