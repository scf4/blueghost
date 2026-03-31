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
    default:
      console.log(`blueghost

Usage:
  bun run cli:setup
  bun run cli:status
  bun run cli:uninstall

Direct:
  bun run src/cli.ts setup
  bun run src/cli.ts status
  bun run src/cli.ts uninstall
`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
