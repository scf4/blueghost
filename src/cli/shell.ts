export interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export function runCommand(
  command: string,
  args: string[],
  options: { check?: boolean } = {},
): CommandResult {
  const result = Bun.spawnSync([command, ...args], {
    cwd: process.cwd(),
    env: process.env,
  });

  const output = {
    status: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout).trimEnd(),
    stderr: new TextDecoder().decode(result.stderr).trimEnd(),
  };

  if (options.check && result.exitCode !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed\nstdout:\n${output.stdout}\nstderr:\n${output.stderr}`,
    );
  }

  return output;
}

export function isCommandAvailable(command: string): boolean {
  return Boolean(Bun.which(command));
}
