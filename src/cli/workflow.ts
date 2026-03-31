import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import {
  DEFAULT_NPM_UPSTREAM,
  DEFAULT_PYPI_UPSTREAM,
} from "../config";

import {
  configurePackageManagers,
  detectPackageManagers,
  getPackageManagerStatus,
  localProxyOrigin,
  pickSuggestedNpmUpstream,
  pickSuggestedPypiUpstream,
  restorePackageManagers,
} from "./package-managers";
import { normalizeUpstream, probePythonUpstream } from "./probe";
import { installService, uninstallService } from "./service";
import {
  deleteSetupRecord,
  loadSetupRecord,
  saveSetupRecord,
} from "./state";
import type { SetupChoices, SetupRecord } from "./types";

export async function runSetupCommand() {
  const existing = loadSetupRecord();
  const detections = detectPackageManagers();
  const prompts = await createPromptSession();

  try {
    printDetectedManagers(detections);

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
      if (choices.pypiUpstream !== DEFAULT_PYPI_UPSTREAM) {
        console.log(
          `\nWarning: custom Python upstream detected (${choices.pypiUpstream}).`,
        );
        console.log(
          "blueghost will only enable Python support if the upstream exposes the metadata needed for safe filtering.\n",
        );
      }

      const probe = await probePythonUpstream(choices.pypiUpstream);
      if (!probe.ok) {
        console.log(`Python support disabled: ${probe.message}`);
        pythonEnabled = false;
      } else {
        console.log(probe.message);
        pythonVerified = true;
      }
    }

    if (!choices.enableJs && !pythonEnabled) {
      throw new Error("setup would enable no ecosystems after Python verification");
    }

    installService({
      port: choices.port,
      quarantineHours: choices.quarantineHours,
      npmUpstream: choices.npmUpstream,
      pypiUpstream: choices.pypiUpstream,
      enablePython: pythonEnabled,
      verifiedPypiUpstream: pythonVerified ? choices.pypiUpstream : "",
    });

    const configuredPackageManagers = configurePackageManagers({
      port: choices.port,
      jsEnabled: choices.enableJs,
      pythonEnabled,
    });

    const record: SetupRecord = {
      version: 1,
      port: choices.port,
      quarantineHours: choices.quarantineHours,
      upstreams: {
        npm: choices.npmUpstream,
        pypi: choices.pypiUpstream,
      },
      ecosystems: {
        js: choices.enableJs,
        python: pythonEnabled,
      },
      python: {
        verified: pythonVerified,
      },
      configuredPackageManagers,
      updatedAt: new Date().toISOString(),
    };

    saveSetupRecord(record);

    console.log("\nSetup complete.");
    console.log(`Proxy: ${localProxyOrigin(choices.port)}`);
    console.log(`JS/TS protection: ${choices.enableJs ? "enabled" : "disabled"}`);
    console.log(
      `Python protection: ${
        pythonEnabled ? "enabled (verified)" : choices.enablePython ? "disabled" : "disabled"
      }`,
    );
  } finally {
    prompts.close();
  }
}

export async function runStatusCommand() {
  const record = loadSetupRecord();
  if (!record) {
    console.log("No CLI setup record found.");
    return;
  }

  const proxyOrigin = localProxyOrigin(record.port);
  const serviceHealthy = await isServiceResponsive(proxyOrigin);
  const statuses = getPackageManagerStatus(record.port);

  console.log("blueghost status\n");
  console.log(`Service: ${serviceHealthy ? "running" : "not running"} (${proxyOrigin})`);
  console.log(
    `JS/TS: ${record.ecosystems.js ? "enabled" : "disabled"}${
      record.ecosystems.js ? renderManagerSummary(["npm", "pnpm", "yarn", "bun"], statuses) : ""
    }`,
  );
  console.log(
    `Python: ${
      record.ecosystems.python
        ? record.python.verified
          ? "enabled (verified)"
          : "enabled (unverified)"
        : "disabled"
    }${
      record.ecosystems.python
        ? renderManagerSummary(["pip", "uv"], statuses)
        : ""
    }`,
  );
  if (!record.python.verified && record.upstreams.pypi !== DEFAULT_PYPI_UPSTREAM) {
    console.log("Warning: Python upstream is custom and not verified.");
  }
}

export async function runUninstallCommand() {
  const record = loadSetupRecord();
  if (!record) {
    console.log("No CLI setup record found. Removing service if present.");
    uninstallService();
    return;
  }

  restorePackageManagers(record.configuredPackageManagers);
  uninstallService();
  deleteSetupRecord();

  console.log("blueghost uninstall complete.");
}

function printDetectedManagers(detections: ReturnType<typeof detectPackageManagers>) {
  const detected = Object.entries(detections)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);

  console.log("Detected package managers:");
  console.log(detected.length > 0 ? `  ${detected.join(", ")}` : "  none");
  console.log("");
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
    await fetch(`${proxyOrigin}/`, { signal: AbortSignal.timeout(2_000) });
    return true;
  } catch {
    return false;
  }
}

function renderManagerSummary(
  managers: Array<keyof ReturnType<typeof getPackageManagerStatus>>,
  statuses: ReturnType<typeof getPackageManagerStatus>,
): string {
  const active = managers.filter((manager) => statuses[manager]);
  return active.length > 0 ? ` (${active.join(", ")})` : " (not configured)";
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
