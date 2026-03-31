export const DEFAULT_NPM_UPSTREAM = "https://registry.npmjs.org";
export const DEFAULT_PYPI_UPSTREAM = "https://pypi.org";

const hours = parseInt(process.env.QUARANTINE_HOURS || "18", 10);
const enablePython = process.env.ENABLE_PYTHON === "1";
const verifiedPypiUpstream = process.env.VERIFIED_PYPI_UPSTREAM || "";
const pypiUpstream = process.env.PYPI_UPSTREAM || DEFAULT_PYPI_UPSTREAM;

export const config = {
  port: parseInt(process.env.PORT || "4873", 10),
  quarantineHours: Number.isFinite(hours) && hours > 0 ? hours : 18,
  npmUpstream: process.env.NPM_UPSTREAM || DEFAULT_NPM_UPSTREAM,
  pypiUpstream,
  enablePython,
  pythonUpstreamVerified:
    pypiUpstream === DEFAULT_PYPI_UPSTREAM ||
    verifiedPypiUpstream === pypiUpstream,
};

export const QUARANTINE_MS = config.quarantineHours * 3_600_000;
