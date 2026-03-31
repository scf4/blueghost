# blueghost

<img src="./assets/vulnerable-ghost.png" alt="vulnerable Pac-Man ghost" width="28"> <img src="./assets/vulnerable-ghost.png" alt="vulnerable Pac-Man ghost" width="28"> <img src="./assets/vulnerable-ghost.png" alt="vulnerable Pac-Man ghost" width="28"> <img src="./assets/vulnerable-ghost.png" alt="vulnerable Pac-Man ghost" width="28">

**blueghost** sits between your package manager and the upstream registry, quarantining newly published versions of packages for a short amount of time (default: 18 hours).

> **IMPORTANT:** The project is new, in active development, and should be used with caution. Please report any issues or flaws. PRs are welcome, personal forks are encouraged.

Currently works with **npm, pnpm, yarn, Bun, pip, and uv.**

See [Adding a new registry](#adding-a-new-registry) for other ecosystems.

## Installation

Given the security implications, blueghost will not yet be published to npm or distributed any other way until it is in a more mature state. For now, clone the repo and follow the instructions below.

```bash
git clone https://github.com/scf4/blueghost
cd blueghost

# Install as a background service (launchd on macOS, systemd on Linux)
./setup.sh install

# Configure all detected package managers to route through the proxy
./setup.sh set-defaults
```

## How it works

```
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

The same logic applies to every package in the dependency tree. If `axios` pulls in `follow-redirects` and that package has a 2-hour-old version, it gets stripped too — even if nothing pins it.

> **Note:** If **all** versions of a package are newer than the quarantine window (i.e. it's a brand-new package), every version passes through unchanged. The quarantine targets malicious *updates* to existing packages, not new packages.

## Commands

```bash
./setup.sh install         # Install background service
./setup.sh uninstall       # Remove background service
./setup.sh set-defaults    # Point all package managers at proxy
./setup.sh unset-defaults  # Revert to upstream registries
./setup.sh status          # Check what's running & configured
```

## Important caveats

**Project-level overrides.** The proxy configures registries at the global level. A project with its own `.npmrc`, `bunfig.toml`, or `pyproject.toml` pointing at a different registry will bypass the proxy. This is usually desirable (private registries), but be aware of it.

**Extra indexes (pip).** If you have `--extra-index-url` configured for private packages, those additional indexes bypass the proxy. Only the primary `--index-url` is rerouted.

**Private registries.** Set `NPM_UPSTREAM` and `PYPI_UPSTREAM` to your upstream registry URLs as needed. The proxy doesn't currently forward authentication headers.

## Configuration

Everything is via environment variables:

| Variable | Default | Description |
|---|---|---|
| `QUARANTINE_HOURS` | `18` | How many hours a version must age before it's allowed through |
| `PORT` | `4873` | Port the proxy listens on |
| `NPM_UPSTREAM` | `https://registry.npmjs.org` | Upstream npm registry |
| `PYPI_UPSTREAM` | `https://pypi.org` | Upstream PyPI |

To change settings for an installed service, edit the environment variables in the launchd plist (`~/Library/LaunchAgents/com.blueghost.proxy.plist`) or the systemd unit (`~/.config/systemd/user/blueghost.service`), then restart the service. Or pass them when installing:

```bash
QUARANTINE_HOURS=72 PORT=5555 ./setup.sh install
```

## Manual package manager setup

If you prefer to configure things yourself instead of using `setup.sh set-defaults`:

```bash
# npm / yarn classic / pnpm
npm config set registry http://127.0.0.1:4873

# bun – add to ~/.bunfig.toml
[install]
registry = "http://127.0.0.1:4873"

# pip
pip config set global.index-url http://127.0.0.1:4873/simple/
pip config set global.trusted-host 127.0.0.1

# uv
export UV_INDEX_URL="http://127.0.0.1:4873/simple/"

# poetry – in pyproject.toml
[[tool.poetry.source]]
name = "quarantine"
url = "http://127.0.0.1:4873/simple/"
priority = "primary"
```


## Adding a new registry
<a id="adding-a-new-registry"></a>

Each registry is currently a single file in `src/`. The pattern is: 1) Fetch upstream metadata, 2) Filter out versions newer than the quarantine window, 3) Return the modified metadata to the package manager.

See `src/npm.ts` or `src/pypi.ts` for examples.

## License

MIT
