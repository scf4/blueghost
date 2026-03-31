import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export interface SetupTestEnvironment {
  home: string;
  binDir: string;
  stateDir: string;
  xdgStateHome: string;
}

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const setupScript = join(repoRoot, "setup.sh");
const tempDirs: string[] = [];

export function cleanupSetupFixtures() {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
}

export function createFakeSetupEnvironment(): SetupTestEnvironment {
  const root = mkdtempSync(join(tmpdir(), "ghostgate-"));
  tempDirs.push(root);

  const home = join(root, "home");
  const binDir = join(root, "bin");
  const stateDir = join(root, "fake-state");
  const xdgStateHome = join(root, "xdg-state");

  mkdirSync(home, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(xdgStateHome, { recursive: true });

  writeCommand(join(binDir, "npm"), fakeConfigCommand());
  writeCommand(join(binDir, "pnpm"), fakeConfigCommand());
  writeCommand(join(binDir, "pip3"), fakeConfigCommand());
  writeCommand(
    join(binDir, "yarn"),
    fakeConfigCommand({ supportsVersion: true }),
  );
  writeCommand(join(binDir, "bun"), "#!/usr/bin/env bash\nexit 0\n");
  writeCommand(join(binDir, "uv"), "#!/usr/bin/env bash\nexit 0\n");
  writeCommand(join(binDir, "launchctl"), "#!/usr/bin/env bash\nexit 0\n");
  writeCommand(join(binDir, "systemctl"), "#!/usr/bin/env bash\nexit 0\n");

  return { home, binDir, stateDir, xdgStateHome };
}

export function runSetup(
  env: SetupTestEnvironment,
  command: string,
  extraEnv: Record<string, string> = {},
) {
  const result = spawnSync("bash", [setupScript, command], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: env.home,
      PATH: `${env.binDir}:${process.env.PATH || ""}`,
      SHELL: "/bin/zsh",
      FAKE_STATE_DIR: env.stateDir,
      XDG_STATE_HOME: env.xdgStateHome,
      ...extraEnv,
    },
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(
      `setup.sh ${command} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
}

export function seedConfig(
  stateDir: string,
  command: string,
  key: string,
  value: string,
) {
  writeFileSync(join(stateDir, `${command}.${key}`), value);
}

export function readConfig(stateDir: string, command: string, key: string) {
  const file = join(stateDir, `${command}.${key}`);
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

function fakeConfigCommand(options: { supportsVersion?: boolean } = {}) {
  const versionHandler = options.supportsVersion
    ? 'if [[ "${1:-}" == "--version" ]]; then echo "4.0.0"; exit 0; fi\n'
    : "";

  return `#!/usr/bin/env bash
set -euo pipefail
state_dir="\${FAKE_STATE_DIR:?}"
store_prefix="\${state_dir}/\${0##*/}"
mkdir -p "\${state_dir}"
${versionHandler}if [[ "\${1:-}" != "config" ]]; then
  echo "unsupported command" >&2
  exit 1
fi
action="\${2:-}"
key="\${3:-}"
safe_key="\${key//\\//_}"
safe_key="\${safe_key// /_}"
file="\${store_prefix}.\${safe_key}"
case "\${action}" in
  get)
    if [[ -f "\${file}" ]]; then
      cat "\${file}"
    else
      echo "undefined"
    fi
    ;;
  set)
    printf '%s' "\${4:-}" > "\${file}"
    ;;
  delete|unset)
    rm -f "\${file}"
    ;;
  *)
    echo "unsupported config action" >&2
    exit 1
    ;;
esac
`;
}

function writeCommand(path: string, content: string) {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}
