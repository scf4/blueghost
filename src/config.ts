const hours = parseInt(process.env.QUARANTINE_HOURS || "18", 10);

export const config = {
  port: parseInt(process.env.PORT || "4873", 10),
  quarantineHours: Number.isFinite(hours) && hours > 0 ? hours : 18,
  npmUpstream: process.env.NPM_UPSTREAM || "https://registry.npmjs.org",
  pypiUpstream: process.env.PYPI_UPSTREAM || "https://pypi.org",
};

export const QUARANTINE_MS = config.quarantineHours * 3_600_000;
