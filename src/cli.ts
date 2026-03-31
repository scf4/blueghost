#!/usr/bin/env bun

import {
  runSetupCommand,
  runStatusCommand,
  runUninstallCommand,
} from "./cli/workflow";

const command = process.argv[2] || "help";

try {
  switch (command) {
    case "setup":
      await runSetupCommand();
      break;
    case "status":
      await runStatusCommand();
      break;
    case "uninstall":
      await runUninstallCommand();
      break;
    default: {
      const dim = process.stdout.isTTY ? "\x1b[2m" : "";
      const bold = process.stdout.isTTY ? "\x1b[1m" : "";
      const blue = process.stdout.isTTY ? "\x1b[34m\x1b[1m" : "";
      const reset = process.stdout.isTTY ? "\x1b[0m" : "";

      console.log(`
  ${blue}blueghost${reset}  ${dim}registry quarantine proxy${reset}

  ${bold}Commands${reset}
    setup       Configure protection and install the background service
    status      Show current protection state
    uninstall   Remove service and restore package manager configs

  ${bold}Usage${reset}
    ${dim}$${reset} bun run cli:setup
    ${dim}$${reset} bun run cli:status
    ${dim}$${reset} bun run cli:uninstall
`);
      break;
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
