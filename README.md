# blueghost

<img src="./assets/vulnerable-ghost.png" alt="vulnerable Pac-Man ghost" width="28"> <img src="./assets/vulnerable-ghost.png" alt="vulnerable Pac-Man ghost" width="28"> <img src="./assets/vulnerable-ghost.png" alt="vulnerable Pac-Man ghost" width="28"> <img src="./assets/vulnerable-ghost.png" alt="vulnerable Pac-Man ghost" width="28">

A local registry proxy to keep your package managers safe from malicious updates.

**blueghost** sits between your package manager and the upstream registry, stripping out any recently published version Your tools never even see the poisoned version.

Works with **npm, pnpm, yarn, Bun, pip, and uv.**

## Installation

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
bun install axios          npm registry
       │                        │
       ▼                        │
  blueghost ──fetch──►     │
       │                        │
       │  "axios 1.7.4 was published 6h ago"
       │  "axios 1.7.3 was published 40 days ago"
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

If **all** versions of a package are newer than the quarantine window (i.e. it's a brand-new package), every version passes through unchanged. The quarantine targets malicious *updates* to existing packages, not new packages.

## Configuration

Everything is via environment variables:

| Variable | Default | Description |
|---|---|---|
| `QUARANTINE_HOURS` | `18` | How many hours a version must age before it's allowed through |
| `PORT` | `4873` | Port the proxy listens on |
| `NPM_UPSTREAM` | `https://registry.npmjs.org` | Upstream npm registry |
| `PYPI_UPSTREAM` | `https://pypi.org` | Upstream PyPI |

To change settings for an installed service, edit the env in the launchd plist (`~/Library/LaunchAgents/com.blueghost.proxy.plist`) or systemd unit (`~/.config/systemd/user/blueghost.service`) and restart. Or pass them when installing:

```bash
QUARANTINE_HOURS=72 PORT=5555 ./setup.sh install
```

## Manual package manager setup

If you prefer to configure things yourself instead of using `setup.sh set-defaults`:

```bash
# npm / yarn classic / pnpm
npm config set registry http://localhost:4873

# bun – add to ~/.bunfig.toml
[install]
registry = "http://localhost:4873"

# pip
pip config set global.index-url http://localhost:4873/simple/
pip config set global.trusted-host localhost

# uv
export UV_INDEX_URL="http://localhost:4873/simple/"

# poetry – in pyproject.toml
[[tool.poetry.source]]
name = "quarantine"
url = "http://localhost:4873/simple/"
priority = "primary"
```

## Commands

```bash
./setup.sh install         # Install background service
./setup.sh uninstall       # Remove background service
./setup.sh set-defaults    # Point all package managers at proxy
./setup.sh unset-defaults  # Revert to upstream registries
./setup.sh status          # Check what's running & configured
```

## Important caveats

**Local package caches.** If you installed a compromised version *before* enabling the proxy, it's sitting in your local cache and your package manager won't re-fetch it. After first install, consider clearing caches:

```bash
# npm
npm cache clean --force

# bun
rm -rf ~/.bun/install/cache

# pnpm
pnpm store prune

# pip
pip cache purge
```

**Lockfiles.** If your lockfile already pins a compromised version, the proxy can't help — the package manager requests that exact tarball directly. After enabling the proxy, delete your lockfile and re-resolve to get a clean baseline.

**Project-level overrides.** The proxy configures registries at the global level. A project with its own `.npmrc`, `bunfig.toml`, or `pyproject.toml` pointing at a different registry will bypass the proxy. This is usually desirable (private registries), but be aware of it.

**Extra indexes (pip).** If you have `--extra-index-url` configured for private packages, those additional indexes bypass the proxy. Only the primary `--index-url` is rerouted.

**Private registries.** Set `NPM_UPSTREAM` to your private registry URL. The proxy doesn't currently forward authentication headers — if your upstream requires auth, you'll need to add token forwarding (PRs welcome).

**CI/CD.** In CI you'd either run the proxy as a service step before `install`, or use pre-vetted lockfiles. The proxy is designed for developer machines, not build pipelines (where lockfile pinning is the primary defense).

**No local cache.** Every metadata request goes to upstream. This keeps the code simple and avoids stale data. The added latency is negligible for typical installs.

## Adding a new registry

Each registry is a single file in `src/`. The pattern is:

1. Fetch upstream metadata
2. Find version timestamps
3. Filter out versions newer than the quarantine window
4. If all versions are new, pass through unchanged
5. Return filtered metadata

See `src/npm.ts` or `src/pypi.ts` for the full pattern. Potential additions: crates.io (Rust), proxy.golang.org (Go), RubyGems.

## License

MIT
