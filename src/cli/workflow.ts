import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import {
  DEFAULT_NPM_UPSTREAM,
  DEFAULT_PYPI_UPSTREAM,
} from "../config";

import { banner, fail, fmt, gap, item, section, success, warn } from "./format";
import {
  configurePackageManagers,
  detectPackageManagers,
  getPackageManagerStatus,
  localProxyOrigin,
  plannedPackageManagers,
  pickSuggestedNpmUpstream,
  pickSuggestedPypiUpstream,
  restorePackageManagers,
} from "./package-managers";
import { normalizeUpstream, probePythonUpstream } from "./probe";
import { installService, uninstallService } from "./service";
import {
  deletePendingSetup,
  deleteSetupRecord,
  loadPendingSetup,
  loadSetupRecord,
  savePendingSetup,
  saveSetupRecord,
} from "./state";
import type {
  PendingSetupRecord,
  SetupChoices,
  SetupRecord,
  SupportedPackageManager,
} from "./types";

export async function runSetupCommand() {
  recoverFromPendingSetup();
  const existing = loadSetupRecord();
  const detections = detectPackageManagers();
  const prompts = await createPromptSession();

  try {
    banner();
    printDetectedManagers(detections);
    gap();

    const defaults = {
      port: existing?.port ?? 4873,
      quarantineHours: existing?.quarantineHours ?? 18,
      npmUpstream:
        existing?.upstreams.npm ?? pickSuggestedNpmUpstream(DEFAULT_NPM_UPSTREAM),
      pypiUpstream:
        existing?.upstreams.pypi ??
        pickSuggestedPypiUpstream(DEFAULT_PYPI_UPSTREAM),
      enableJs: existing?.ecosystems.js ?? true,
      enablePython: existing?.ecosystems.python ?? false,
    };

    section("Ecosystems");
    gap();
    const enableJs = await promptYesNo(
      prompts,
      "Enable JS/TS protection for npm/pnpm/yarn/bun?",
      defaults.enableJs,
    );
    const enablePython = await promptYesNo(
      prompts,
      "Enable Python protection for pip/uv?",
      defaults.enablePython,
    );

    gap();
    section("Settings");
    gap();
    const choices: SetupChoices = {
      enableJs,
      enablePython,
      quarantineHours: await promptNumber(
        prompts,
        "Quarantine hours",
        defaults.quarantineHours,
      ),
      port: await promptNumber(prompts, "Proxy port", defaults.port),
      npmUpstream: enableJs
        ? normalizeUpstream(
            await promptText(prompts, "npm upstream", defaults.npmUpstream),
          )
        : defaults.npmUpstream,
      pypiUpstream: enablePython
        ? normalizeUpstream(
            await promptText(prompts, "Python upstream", defaults.pypiUpstream),
          )
        : defaults.pypiUpstream,
    };

    if (!choices.enableJs && !choices.enablePython) {
      throw new Error("no ecosystems selected");
    }

    let pythonEnabled = choices.enablePython;
    let pythonVerified = false;

    if (pythonEnabled) {
      gap();
      section("Python verification");
      gap();
      if (choices.pypiUpstream !== DEFAULT_PYPI_UPSTREAM) {
        warn(`Custom Python upstream: ${choices.pypiUpstream}`);
        console.log(`    ${fmt.dim("Probing to verify metadata availability...")}`);
        gap();
      }

      const probe = await probePythonUpstream(choices.pypiUpstream);
      if (!probe.ok) {
        fail(`Python support disabled: ${probe.message}`);
        pythonEnabled = false;
      } else {
        success(probe.message);
        pythonVerified = true;
      }
    }

    if (!choices.enableJs && !pythonEnabled) {
      throw new Error("setup would enable no ecosystems after Python verification");
    }

    const intendedManagers = plannedPackageManagers({
      jsEnabled: choices.enableJs,
      pythonEnabled,
    });
    const previousManagers = existing?.configuredPackageManagers ?? [];
    const disabledManagers = previousManagers.filter((manager) =>
      !intendedManagers.includes(manager)
    );
    const intendedRecord = buildSetupRecord({
      choices,
      pythonEnabled,
      pythonVerified,
      configuredPackageManagers: intendedManagers,
    });
    const pendingRecord: PendingSetupRecord = {
      version: 1,
      previousRecord: existing,
      intendedRecord,
      affectedPackageManagers: uniqueManagers([
        ...previousManagers,
        ...intendedManagers,
      ]),
      updatedAt: new Date().toISOString(),
    };

    savePendingSetup(pendingRecord);

    if (disabledManagers.length > 0) {
      restorePackageManagers(disabledManagers);
    }

    gap();
    section("Installing");
    gap();

    installService({
      port: choices.port,
      quarantineHours: choices.quarantineHours,
      npmUpstream: choices.npmUpstream,
      pypiUpstream: choices.pypiUpstream,
      enablePython: pythonEnabled,
      verifiedPypiUpstream: pythonVerified ? choices.pypiUpstream : "",
    });
    success("Background service installed");

    const configuredPackageManagers = configurePackageManagers({
      port: choices.port,
      jsEnabled: choices.enableJs,
      pythonEnabled,
    });

    for (const pm of configuredPackageManagers) {
      success(`${pm} configured`);
    }

    const record = buildSetupRecord({
      choices,
      pythonEnabled,
      pythonVerified,
      configuredPackageManagers,
    });

    saveSetupRecord(record);
    deletePendingSetup();

    gap();
    section("Done");
    gap();
    item("Proxy", localProxyOrigin(choices.port));
    item("Quarantine", `${choices.quarantineHours}h`);
    item("JS/TS", choices.enableJs ? fmt.green("enabled") : fmt.dim("disabled"), choices.enableJs);
    item("Python", pythonEnabled ? fmt.green("enabled (verified)") : fmt.dim("disabled"), pythonEnabled);
    gap();
    console.log(`  ${fmt.dim("Run")} bun run cli:status ${fmt.dim("to check protection state.")}`);
    gap();
  } finally {
    prompts.close();
  }
}

export async function runStatusCommand() {
  const pending = loadPendingSetup();
  const record = loadSetupRecord();
  if (!record && !pending) {
    console.log("No CLI setup record found.");
    return;
  }

  banner();

  if (pending) {
    warn("Previous setup did not complete cleanly.");
    gap();
  }

  const effectiveRecord = record ?? pending!.intendedRecord;
  const proxyOrigin = localProxyOrigin(effectiveRecord.port);
  const serviceHealthy = await isServiceResponsive(proxyOrigin);
  const statuses = getPackageManagerStatus(effectiveRecord.port);

  section("Service");
  gap();
  if (serviceHealthy) {
    item("Status", fmt.green("running"));
    item("Address", proxyOrigin);
  } else {
    item("Status", fmt.red("not running"), false);
    item("Address", proxyOrigin, false);
  }
  gap();

  section("Protection");
  gap();
  const jsLabel = effectiveRecord.ecosystems.js ? fmt.green("enabled") : fmt.dim("disabled");
  const jsManagers = effectiveRecord.ecosystems.js
    ? ` ${fmt.dim(renderManagerList(["npm", "pnpm", "yarn", "bun"], statuses))}`
    : "";
  item("JS/TS", `${jsLabel}${jsManagers}`, effectiveRecord.ecosystems.js);

  const pythonLabel = effectiveRecord.ecosystems.python
    ? effectiveRecord.python.verified
      ? fmt.green("enabled (verified)")
      : fmt.yellow("enabled (unverified)")
    : fmt.dim("disabled");
  const pythonManagers = effectiveRecord.ecosystems.python
    ? ` ${fmt.dim(renderManagerList(["pip", "uv"], statuses))}`
    : "";
  item("Python", `${pythonLabel}${pythonManagers}`, effectiveRecord.ecosystems.python);

  if (!effectiveRecord.python.verified && effectiveRecord.upstreams.pypi !== DEFAULT_PYPI_UPSTREAM) {
    gap();
    warn("Python upstream is custom and not verified.");
  }
  gap();
}

export async function runUninstallCommand() {
  const pending = loadPendingSetup();
  const record = loadSetupRecord();

  banner();

  if (!record && !pending) {
    console.log(`  ${fmt.dim("No setup record found. Removing service if present.")}`);
    uninstallService();
    gap();
    return;
  }

  if (pending) {
    restorePackageManagers(pending.affectedPackageManagers);
  } else if (record) {
    restorePackageManagers(record.configuredPackageManagers);
  }
  uninstallService();
  deleteSetupRecord();
  deletePendingSetup();

  success("Service removed");
  success("Package manager configs restored");
  success("Setup record cleared");
  gap();
  console.log(`  ${fmt.dim("blueghost has been fully uninstalled.")}`);
  gap();
}

function printDetectedManagers(detections: ReturnType<typeof detectPackageManagers>) {
  const detected = Object.entries(detections)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);

  section("Detected");
  gap();
  if (detected.length > 0) {
    console.log(`  ${fmt.dim("*")} ${detected.join(fmt.dim(", "))}`);
  } else {
    console.log(`  ${fmt.dim("  none")}`);
  }
}

async function promptYesNo(
  prompts: PromptSession,
  prompt: string,
  defaultValue: boolean,
): Promise<boolean> {
  const suffix = defaultValue ? "[Y/n]" : "[y/N]";
  while (true) {
    const answer = (await prompts.question(`${prompt} ${suffix} `)).trim().toLowerCase();
    if (answer === "") return defaultValue;
    if (["y", "yes"].includes(answer)) return true;
    if (["n", "no"].includes(answer)) return false;
  }
}

async function promptNumber(
  prompts: PromptSession,
  prompt: string,
  defaultValue: number,
): Promise<number> {
  while (true) {
    const answer = (await prompts.question(`${prompt} [${defaultValue}] `)).trim();
    if (answer === "") return defaultValue;
    const parsed = parseInt(answer, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
}

async function promptText(
  prompts: PromptSession,
  prompt: string,
  defaultValue: string,
): Promise<string> {
  const answer = (await prompts.question(`${prompt} [${defaultValue}] `)).trim();
  return answer || defaultValue;
}

async function isServiceResponsive(proxyOrigin: string): Promise<boolean> {
  try {
    const res = await fetch(`${proxyOrigin}/healthz`, {
      signal: AbortSignal.timeout(2_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function recoverFromPendingSetup() {
  const pending = loadPendingSetup();
  if (!pending) {
    return;
  }

  warn("Recovering from incomplete previous setup.");
  // Prefer a full restore to the user's pre-blueghost state over trying to
  // preserve a half-applied setup. A failed rerun should never strand package
  // managers pointing at a proxy configuration we can no longer trust.
  restorePackageManagers(pending.affectedPackageManagers);
  uninstallService();
  deleteSetupRecord();
  deletePendingSetup();
}

function renderManagerList(
  managers: Array<keyof ReturnType<typeof getPackageManagerStatus>>,
  statuses: ReturnType<typeof getPackageManagerStatus>,
): string {
  const active = managers.filter((manager) => statuses[manager]);
  return active.length > 0 ? `(${active.join(", ")})` : "(not configured)";
}

interface PromptSession {
  question(prompt: string): Promise<string>;
  close(): void;
}

async function createPromptSession(): Promise<PromptSession> {
  if (input.isTTY && output.isTTY) {
    const rl = createInterface({ input, output });
    return {
      question(prompt: string) {
        return rl.question(prompt);
      },
      close() {
        rl.close();
      },
    };
  }

  const answers = splitAnswers(await readAllStdin());
  let index = 0;

  return {
    async question(prompt: string) {
      output.write(prompt);
      const answer = answers[index] ?? "";
      index += 1;
      output.write("\n");
      return answer;
    },
    close() {},
  };
}

async function readAllStdin(): Promise<string> {
  let text = "";
  input.setEncoding("utf8");
  for await (const chunk of input) {
    text += chunk;
  }
  return text;
}

function splitAnswers(text: string): string[] {
  const lines = text.split(/\r?\n/);
  if (lines.length > 0 && lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}

function buildSetupRecord(options: {
  choices: SetupChoices;
  pythonEnabled: boolean;
  pythonVerified: boolean;
  configuredPackageManagers: SupportedPackageManager[];
}): SetupRecord {
  return {
    version: 1,
    port: options.choices.port,
    quarantineHours: options.choices.quarantineHours,
    upstreams: {
      npm: options.choices.npmUpstream,
      pypi: options.choices.pypiUpstream,
    },
    ecosystems: {
      js: options.choices.enableJs,
      python: options.pythonEnabled,
    },
    python: {
      verified: options.pythonVerified,
    },
    configuredPackageManagers: options.configuredPackageManagers,
    updatedAt: new Date().toISOString(),
  };
}

function uniqueManagers(
  managers: SupportedPackageManager[],
): SupportedPackageManager[] {
  return [...new Set(managers)];
}
