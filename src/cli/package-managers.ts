import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

import { DEFAULT_NPM_UPSTREAM, DEFAULT_PYPI_UPSTREAM } from "../config";

import { runCommand, isCommandAvailable } from "./shell";
import {
  backupFileOnce,
  backupValueOnce,
  clearStateValue,
  hasSavedValue,
  isStateUnset,
  loadStateValue,
  restoreFileBackup,
} from "./state";
import type { PackageManagerDetection, SupportedPackageManager } from "./types";

const PROXY_HOST = "127.0.0.1";
const UV_MARKER = "# blueghost";

export function detectPackageManagers(): PackageManagerDetection {
  return {
    npm: isCommandAvailable("npm"),
    pnpm: isCommandAvailable("pnpm"),
    yarn: isCommandAvailable("yarn"),
    bun: isCommandAvailable("bun"),
    pip: isCommandAvailable("pip3") || isCommandAvailable("pip"),
    uv: isCommandAvailable("uv"),
  };
}

export function pickSuggestedNpmUpstream(
  fallback = DEFAULT_NPM_UPSTREAM,
): string {
  const configured = getConfigValue("npm", ["config", "get", "registry"]);
  if (hasSavedValue(configured) && !isProxyValue(configured || "")) {
    return normalizeUpstream(configured || fallback);
  }

  return fallback;
}

export function pickSuggestedPypiUpstream(
  fallback = DEFAULT_PYPI_UPSTREAM,
): string {
  const pip = resolvePipCommand();
  if (pip) {
    const configured = getConfigValue(pip, ["config", "get", "global.index-url"]);
    const normalized = toPypiUpstream(configured);
    if (normalized) {
      return normalized;
    }
  }

  const uvIndex = process.env.UV_INDEX_URL;
  const uvUpstream = toPypiUpstream(uvIndex);
  if (uvUpstream) {
    return uvUpstream;
  }

  return fallback;
}

export function configurePackageManagers(options: {
  port: number;
  jsEnabled: boolean;
  pythonEnabled: boolean;
}): SupportedPackageManager[] {
  const configured: SupportedPackageManager[] = [];

  if (options.jsEnabled) {
    configured.push(...configureJsManagers(options.port));
  }

  if (options.pythonEnabled) {
    configured.push(...configurePythonManagers(options.port));
  }

  return configured;
}

export function plannedPackageManagers(options: {
  jsEnabled: boolean;
  pythonEnabled: boolean;
}): SupportedPackageManager[] {
  const planned: SupportedPackageManager[] = [];

  if (options.jsEnabled) {
    if (isCommandAvailable("npm")) planned.push("npm");
    if (isCommandAvailable("pnpm")) planned.push("pnpm");
    if (isYarnBerry()) planned.push("yarn");
    if (isCommandAvailable("bun")) planned.push("bun");
  }

  if (options.pythonEnabled) {
    if (resolvePipCommand()) planned.push("pip");
    if (isCommandAvailable("uv")) planned.push("uv");
  }

  return planned;
}

export function restorePackageManagers(
  configured: SupportedPackageManager[],
): SupportedPackageManager[] {
  const restored = new Set<SupportedPackageManager>();

  for (const manager of configured) {
    switch (manager) {
      case "npm":
        if (isCommandAvailable("npm")) {
          restoreConfigValue("npm", "registry", "npm-registry");
          restored.add("npm");
        }
        break;
      case "pnpm":
        if (isCommandAvailable("pnpm")) {
          restoreConfigValue("pnpm", "registry", "pnpm-registry");
          restored.add("pnpm");
        }
        break;
      case "yarn":
        if (isYarnBerry()) {
          const saved = loadStateValue("yarn-npmRegistryServer");
          if (isStateUnset(saved)) {
            runCommand("yarn", ["config", "unset", "npmRegistryServer"]);
          } else if (saved) {
            runCommand("yarn", ["config", "set", "npmRegistryServer", saved], {
              check: true,
            });
          }
          clearStateValue("yarn-npmRegistryServer");
          restored.add("yarn");
        }
        break;
      case "bun":
        restoreBunConfig();
        restored.add("bun");
        break;
      case "pip": {
        const pipCommand = resolvePipCommand();
        if (pipCommand) {
          restoreConfigValue(pipCommand, "global.index-url", "pip-index-url");
          restoreConfigValue(
            pipCommand,
            "global.trusted-host",
            "pip-trusted-host",
          );
          restored.add("pip");
        }
        break;
      }
      case "uv":
        removeUvIndexUrl();
        restored.add("uv");
        break;
    }
  }

  return [...restored];
}

export function getPackageManagerStatus(port: number): Record<string, boolean> {
  const npmRegistry = getConfigValue("npm", ["config", "get", "registry"]);
  const pipCommand = resolvePipCommand();
  const pipIndex = pipCommand
    ? getConfigValue(pipCommand, ["config", "get", "global.index-url"])
    : null;
  const bunfig = resolveBunfigPath();
  const bunConfig = existsSync(bunfig) ? readFileSync(bunfig, "utf8") : "";
  const uvConfig = readUvProfile();
  const proxyOrigin = localProxyOrigin(port);

  return {
    npm: isProxyValue(npmRegistry || ""),
    pnpm: isProxyValue(
      getConfigValue("pnpm", ["config", "get", "registry"]) || "",
    ),
    yarn: isYarnBerry()
      ? isProxyValue(
          getConfigValue("yarn", ["config", "get", "npmRegistryServer"]) || "",
        )
      : isProxyValue(npmRegistry || ""),
    bun: bunConfig.includes(proxyOrigin),
    pip: isProxyValue(pipIndex || ""),
    uv: uvConfig.includes(UV_MARKER) && uvConfig.includes(`${proxyOrigin}/simple/`),
  };
}

function configureJsManagers(port: number): SupportedPackageManager[] {
  const configured: SupportedPackageManager[] = [];
  const registry = localProxyOrigin(port);

  if (isCommandAvailable("npm")) {
    backupValueOnce(
      "npm-registry",
      getConfigValue("npm", ["config", "get", "registry"]),
    );
    runCommand("npm", ["config", "set", "registry", registry], { check: true });
    configured.push("npm");
  }

  if (isCommandAvailable("pnpm")) {
    backupValueOnce(
      "pnpm-registry",
      getConfigValue("pnpm", ["config", "get", "registry"]),
    );
    runCommand("pnpm", ["config", "set", "registry", registry], { check: true });
    configured.push("pnpm");
  }

  if (isYarnBerry()) {
    backupValueOnce(
      "yarn-npmRegistryServer",
      getConfigValue("yarn", ["config", "get", "npmRegistryServer"]),
    );
    runCommand("yarn", ["config", "set", "npmRegistryServer", registry], {
      check: true,
    });
    configured.push("yarn");
  }

  if (isCommandAvailable("bun")) {
    configureBunRegistry(registry);
    configured.push("bun");
  }

  return configured;
}

function configurePythonManagers(port: number): SupportedPackageManager[] {
  const configured: SupportedPackageManager[] = [];
  const pipCommand = resolvePipCommand();
  const indexUrl = `${localProxyOrigin(port)}/simple/`;

  if (pipCommand) {
    backupValueOnce(
      "pip-index-url",
      getConfigValue(pipCommand, ["config", "get", "global.index-url"]),
    );
    backupValueOnce(
      "pip-trusted-host",
      getConfigValue(pipCommand, ["config", "get", "global.trusted-host"]),
    );
    runCommand(
      pipCommand,
      ["config", "set", "global.index-url", indexUrl],
      { check: true },
    );
    runCommand(
      pipCommand,
      ["config", "set", "global.trusted-host", PROXY_HOST],
      { check: true },
    );
    configured.push("pip");
  }

  if (isCommandAvailable("uv")) {
    addUvIndexUrl(indexUrl);
    configured.push("uv");
  }

  return configured;
}

function restoreConfigValue(
  command: string,
  key: string,
  backupKey: string,
) {
  const saved = loadStateValue(backupKey);
  if (isStateUnset(saved)) {
    const action = command === "pip" || command === "pip3" ? "unset" : "delete";
    runCommand(command, ["config", action, key]);
  } else if (saved) {
    runCommand(command, ["config", "set", key, saved], { check: true });
  }

  clearStateValue(backupKey);
}

function resolvePipCommand(): "pip3" | "pip" | null {
  if (isCommandAvailable("pip3")) return "pip3";
  if (isCommandAvailable("pip")) return "pip";
  return null;
}

function getConfigValue(command: string, args: string[]): string | null {
  if (!isCommandAvailable(command)) {
    return null;
  }

  const result = runCommand(command, args);
  if (result.status !== 0) {
    return null;
  }

  return result.stdout.trim() || null;
}

function isYarnBerry(): boolean {
  if (!isCommandAvailable("yarn")) {
    return false;
  }

  const version = runCommand("yarn", ["--version"]);
  return /^(2|3|4)\./.test(version.stdout.trim());
}

function configureBunRegistry(registry: string) {
  const bunfig = resolveBunfigPath();
  backupFileOnce("bunfig", bunfig);

  const current = existsSync(bunfig) ? readFileSync(bunfig, "utf8") : "";
  const next = upsertBunRegistry(current, registry);

  mkdirSync(dirname(bunfig), { recursive: true });
  writeFileSync(bunfig, next);
}

function restoreBunConfig() {
  const bunfig = resolveBunfigPath();
  const restored = restoreFileBackup("bunfig", bunfig);

  if (!restored && existsSync(bunfig)) {
    const filtered = readFileSync(bunfig, "utf8")
      .split("\n")
      .filter((line) => !line.includes("registry") || !isProxyValue(line))
      .join("\n");
    writeFileSync(bunfig, filtered);
  }

  clearStateValue("bunfig");
}

function resolveBunfigPath(): string {
  return join(homedir(), ".bunfig.toml");
}

function upsertBunRegistry(content: string, registry: string): string {
  const lines = content.length > 0 ? content.split("\n") : [];
  const result: string[] = [];
  let inInstall = false;
  let inserted = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      if (inInstall && !inserted) {
        result.push(`registry = "${registry}"`);
        inserted = true;
      }

      inInstall = trimmed === "[install]";
      inserted = false;
      result.push(line);
      continue;
    }

    if (inInstall && /^registry\s*=/.test(trimmed)) {
      if (!inserted) {
        result.push(`registry = "${registry}"`);
        inserted = true;
      }
      continue;
    }

    if (inInstall && trimmed === "" && !inserted) {
      result.push(`registry = "${registry}"`);
      inserted = true;
    }

    result.push(line);
  }

  if (!content.includes("[install]")) {
    if (result.length > 0 && result[result.length - 1] !== "") {
      result.push("");
    }
    result.push("[install]");
    result.push(`registry = "${registry}"`);
  } else if (inInstall && !inserted) {
    result.push(`registry = "${registry}"`);
  }

  return `${result.join("\n").replace(/\n+$/, "")}\n`;
}

function addUvIndexUrl(indexUrl: string) {
  const profile = resolveShellProfile();
  const line = `export UV_INDEX_URL="${indexUrl}" ${UV_MARKER}`;

  if (profile.kind === "fish") {
    mkdirSync(join(homedir(), ".config", "fish"), { recursive: true });
    const varLine = `set -gx UV_INDEX_URL "${indexUrl}"  ${UV_MARKER}`;
    if (!readFileMaybe(profile.path).includes(varLine)) {
      appendLine(profile.path, varLine);
    }
    return;
  }

  if (!readFileMaybe(profile.path).includes(line)) {
    appendLine(profile.path, line);
  }
}

function removeUvIndexUrl() {
  const profile = resolveShellProfile();
  if (!existsSync(profile.path)) return;

  const filtered = readFileSync(profile.path, "utf8")
    .split("\n")
    .filter((line) => !line.includes("UV_INDEX_URL") || !line.includes(UV_MARKER))
    .join("\n");
  writeFileSync(profile.path, `${filtered.replace(/\n+$/, "")}\n`);
}

function resolveShellProfile(): { kind: "fish" | "shell"; path: string } {
  const shell = process.env.SHELL || "";
  if (shell.endsWith("/fish")) {
    return {
      kind: "fish",
      path: join(homedir(), ".config", "fish", "config.fish"),
    };
  }

  if (shell.endsWith("/zsh")) {
    return { kind: "shell", path: join(homedir(), ".zshrc") };
  }

  if (shell.endsWith("/bash")) {
    return { kind: "shell", path: join(homedir(), ".bashrc") };
  }

  return { kind: "shell", path: join(homedir(), ".profile") };
}

function readUvProfile(): string {
  const profile = resolveShellProfile();
  return readFileMaybe(profile.path);
}

function readFileMaybe(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function appendLine(path: string, line: string) {
  mkdirSync(dirname(path), { recursive: true });
  const prefix = existsSync(path) && readFileSync(path, "utf8").endsWith("\n")
    ? ""
    : existsSync(path)
      ? "\n"
      : "";
  writeFileSync(path, `${readFileMaybe(path)}${prefix}${line}\n`);
}

function toPypiUpstream(raw: string | null | undefined): string | null {
  if (!hasSavedValue(raw) || isProxyValue(raw || "")) {
    return null;
  }

  const normalized = normalizeUpstream(raw || "");

  if (normalized.endsWith("/simple")) {
    return normalized.slice(0, -"/simple".length);
  }

  return normalized;
}

function normalizeUpstream(raw: string): string {
  return raw.replace(/\/+$/, "");
}

export function localProxyOrigin(port: number): string {
  return `http://${PROXY_HOST}:${port}`;
}

export function isProxyValue(value: string): boolean {
  return value.includes("localhost") || value.includes(PROXY_HOST);
}
