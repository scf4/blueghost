export type SupportedPackageManager =
  | "npm"
  | "pnpm"
  | "yarn"
  | "bun"
  | "pip"
  | "uv";

export interface PackageManagerDetection {
  npm: boolean;
  pnpm: boolean;
  yarn: boolean;
  bun: boolean;
  pip: boolean;
  uv: boolean;
}

export interface SetupRecord {
  version: 1;
  port: number;
  quarantineHours: number;
  upstreams: {
    npm: string;
    pypi: string;
  };
  ecosystems: {
    js: boolean;
    python: boolean;
  };
  python: {
    verified: boolean;
  };
  configuredPackageManagers: SupportedPackageManager[];
  updatedAt: string;
}

export interface PendingSetupRecord {
  version: 1;
  previousRecord: SetupRecord | null;
  intendedRecord: SetupRecord;
  affectedPackageManagers: SupportedPackageManager[];
  updatedAt: string;
}

export interface SetupChoices {
  port: number;
  quarantineHours: number;
  npmUpstream: string;
  pypiUpstream: string;
  enableJs: boolean;
  enablePython: boolean;
}

export interface PythonProbeResult {
  ok: boolean;
  message: string;
}
