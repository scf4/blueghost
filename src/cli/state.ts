import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

import type { PendingSetupRecord, SetupRecord } from "./types";

const STATE_UNSET = "__BLUEGHOST_UNSET__";

export function resolveStateDir(): string {
  const xdgStateHome = process.env.XDG_STATE_HOME;
  if (xdgStateHome) {
    return join(xdgStateHome, "blueghost");
  }

  return join(homedir(), ".local", "state", "blueghost");
}

export function resolveSetupRecordPath(): string {
  return join(resolveStateDir(), "config.json");
}

export function resolvePendingSetupPath(): string {
  return join(resolveStateDir(), "config.json.pending");
}

export function ensureStateDir() {
  mkdirSync(resolveStateDir(), { recursive: true });
}

export function loadSetupRecord(): SetupRecord | null {
  const path = resolveSetupRecordPath();
  if (!existsSync(path)) return null;

  return JSON.parse(readFileSync(path, "utf8")) as SetupRecord;
}

export function saveSetupRecord(record: SetupRecord) {
  ensureStateDir();
  writeFileSync(resolveSetupRecordPath(), `${JSON.stringify(record, null, 2)}\n`);
}

export function deleteSetupRecord() {
  rmSync(resolveSetupRecordPath(), { force: true });
}

export function loadPendingSetup(): PendingSetupRecord | null {
  const path = resolvePendingSetupPath();
  if (!existsSync(path)) return null;

  return JSON.parse(readFileSync(path, "utf8")) as PendingSetupRecord;
}

export function savePendingSetup(record: PendingSetupRecord) {
  ensureStateDir();
  writeFileSync(resolvePendingSetupPath(), `${JSON.stringify(record, null, 2)}\n`);
}

export function deletePendingSetup() {
  rmSync(resolvePendingSetupPath(), { force: true });
}

export function stateFile(key: string): string {
  return join(resolveStateDir(), key);
}

export function hasSavedValue(value: string | null | undefined): boolean {
  return Boolean(
    value &&
      value !== "default" &&
      value !== "null" &&
      value !== "undefined",
  );
}

export function backupValueOnce(key: string, value: string | null | undefined) {
  const file = stateFile(key);
  const missing = `${file}.missing`;

  if (existsSync(file) || existsSync(missing)) {
    return;
  }

  ensureStateDir();
  if (hasSavedValue(value)) {
    writeFileSync(file, value || "");
  } else {
    writeFileSync(missing, "");
  }
}

export function loadStateValue(key: string): string | null {
  const file = stateFile(key);
  const missing = `${file}.missing`;

  if (existsSync(missing)) {
    return STATE_UNSET;
  }

  if (!existsSync(file)) {
    return null;
  }

  return readFileSync(file, "utf8");
}

export function clearStateValue(key: string) {
  rmSync(stateFile(key), { force: true });
  rmSync(`${stateFile(key)}.missing`, { force: true });
}

export function backupFileOnce(key: string, path: string) {
  const file = stateFile(key);
  const missing = `${file}.missing`;

  if (existsSync(file) || existsSync(missing)) {
    return;
  }

  ensureStateDir();
  if (existsSync(path)) {
    copyFileSync(path, file);
  } else {
    writeFileSync(missing, "");
  }
}

export function restoreFileBackup(key: string, path: string): boolean {
  const file = stateFile(key);
  const missing = `${file}.missing`;

  if (existsSync(missing)) {
    rmSync(path, { force: true });
    rmSync(missing, { force: true });
    return true;
  }

  if (!existsSync(file)) {
    return false;
  }

  mkdirSync(dirname(path), { recursive: true });
  copyFileSync(file, path);
  rmSync(file, { force: true });
  return true;
}

export function isStateUnset(value: string | null): boolean {
  return value === STATE_UNSET;
}
