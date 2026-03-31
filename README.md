# blueghost

<img src="./assets/vulnerable-ghost.png" alt="vulnerable Pac-Man ghost" width="28"> <img src="./assets/vulnerable-ghost.png" alt="vulnerable Pac-Man ghost" width="28"> <img src="./assets/vulnerable-ghost.png" alt="vulnerable Pac-Man ghost" width="28"> <img src="./assets/vulnerable-ghost.png" alt="vulnerable Pac-Man ghost" width="28">

**blueghost** sits between your package manager and the upstream registry, quarantining newly published package versions for a short amount of time (default: 18 hours).

> **Important:** The project is new, in active development, and should be used with caution. Please report issues and flaws. PRs are welcome, and personal forks are encouraged.

blueghost protects **npm, pnpm, yarn, and Bun** by default. **Python support for pip and uv is opt-in** and only activates after setup verifies that the configured PyPI upstream exposes the metadata needed for safe filtering.

## Installation

Given the security implications, blueghost is not published to npm yet. For now, clone the repo and run the local CLI:

```bash
git clone https://github.com/scf4/blueghost
cd blueghost
bun install
bun run cli:setup
```

The setup flow:

- detects installed package managers
- enables JS/TS protection by default
- leaves Python off by default unless you opt in
- probes custom Python upstreams before enabling pip or uv
- installs a background service with launchd on macOS or user systemd on Linux
- backs up existing package-manager config for clean uninstall
- can be re-run safely to change which ecosystems are enabled; configs for disabled ecosystems are restored automatically

## How It Works

```text
bun install axios              npm registry
       │                            │
       ▼                            │
  blueghost ─── fetch ────────────► │
       │                            │
       │  "axios 1.7.4 published 6h ago"
       │  "axios 1.7.3 published 40 days ago"
       │
       │  quarantine = 18h
       │  → strip 1.7.4
       │  → latest = 1.7.3
       │
       ▼
  filtered metadata
  (1.7.4 doesn't exist)
```

The same logic applies throughout the dependency tree. If `axios` pulls in `follow-redirects` and that package has a 2-hour-old version, it gets stripped too even if you did not pin it directly.

If **all** versions of a package are newer than the quarantine window, the package passes through unchanged. blueghost is designed to block suspicious *updates* to existing packages, not brand-new packages.

## CLI Commands

```bash
bun run cli:setup
bun run cli:status
bun run cli:uninstall
```

`cli:status` checks a local health endpoint and reports the current per-ecosystem protection state. If a previous setup attempt did not finish cleanly, it warns before showing the effective state.

You can also run the TypeScript entrypoint directly:

```bash
bun run src/cli.ts setup
bun run src/cli.ts status
bun run src/cli.ts uninstall
```

The Bun CLI is the only supported setup flow.

## Important Caveats

**Project-level overrides.** blueghost configures registries globally. A project with its own `.npmrc`, `bunfig.toml`, `pyproject.toml`, or equivalent registry override can bypass the proxy. That is often desirable for private registries, but it changes what blueghost protects.

**Python support is capability-gated.** Canonical `https://pypi.org` is the tested path. Custom Python upstreams are only enabled if setup can verify the upstream's Simple API and timestamp metadata. If setup cannot verify that capability, pip and uv remain untouched.

**No silent bypass on proxy failure.** If the proxy is unavailable, installs should fail rather than quietly talking to the upstream directly. That is intentional: blueghost should not silently disable its own protection.

**Extra indexes can bypass the proxy.** Additional Python indexes such as `--extra-index-url` or project-level Poetry sources are outside the primary rerouted index unless you configure them separately.

**Authentication passthrough is limited.** blueghost does not currently forward upstream authentication headers. If your private registry requires auth, plan accordingly.

## Configuration

Everything is configured with environment variables on the service:

| Variable | Default | Description |
|---|---|---|
| `QUARANTINE_HOURS` | `18` | How many hours a version must age before it is allowed through |
| `PORT` | `4873` | Local proxy port |
| `NPM_UPSTREAM` | `https://registry.npmjs.org` | Upstream npm registry |
| `PYPI_UPSTREAM` | `https://pypi.org` | Upstream PyPI registry |
| `ENABLE_PYTHON` | `0` | Whether Python routing is enabled in the service |
| `VERIFIED_PYPI_UPSTREAM` | empty unless verified | Records which custom Python upstream passed setup verification |

If you change `PYPI_UPSTREAM`, re-run `bun run cli:setup` so blueghost can probe the new upstream before enabling Python support.

## Manual Package Manager Setup

If you need to point package managers at the proxy manually after running `bun run cli:setup`:

```bash
# npm / yarn classic / pnpm
npm config set registry http://127.0.0.1:4873

# bun – add to ~/.bunfig.toml
[install]
registry = "http://127.0.0.1:4873"

# pip – only when using canonical PyPI or a verified custom upstream
pip config set global.index-url http://127.0.0.1:4873/simple/
pip config set global.trusted-host 127.0.0.1

# uv – only when using canonical PyPI or a verified custom upstream
export UV_INDEX_URL="http://127.0.0.1:4873/simple/"
```

For manual Python setup, the blueghost service must have Python enabled via the CLI; otherwise `/simple/*` requests are rejected even if pip or uv are pointed at the proxy.

## Adding A New Registry

Each registry lives under `src/registry/`. The pattern is:

1. Fetch upstream metadata.
2. Filter out versions or files newer than the quarantine window.
3. Return the modified response to the package manager.

See `src/registry/npm.ts` and `src/registry/pypi.ts` for the current implementations.

Maintainer note: v1 Python filtering depends on the PyPI JSON `releases` field for timestamp data. If PyPI removes that field, migrate timestamp extraction to the Simple API surface, preferably via PEP 700 `data-upload-time`.

## License

MIT
