/**
 * Semver compare + npm registry "latest" parsing for `gitgen update`.
 * Keep network I/O out of pure helpers so tests can drive real functions.
 */

/** Parse core major.minor.patch (ignores pre-release / build suffix for compare). */
export function parseSemverCore(version: string): [number, number, number] | null {
  const m = version.trim().replace(/^v/i, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}

/**
 * Compare two semver-ish strings.
 * @returns negative if a < b, 0 if equal core, positive if a > b
 */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemverCore(a);
  const pb = parseSemverCore(b);
  if (!pa || !pb) {
    // Fallback: string compare if either is non-semver
    return a.trim().localeCompare(b.trim(), undefined, { numeric: true });
  }
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

export function isNewerVersion(latest: string, current: string): boolean {
  return compareSemver(latest, current) > 0;
}

/** Extract `version` from npm registry package metadata JSON (latest tag or root). */
export function parseNpmLatestVersion(registryJson: unknown): string {
  if (!registryJson || typeof registryJson !== "object") {
    throw new Error("Invalid npm registry response");
  }
  const obj = registryJson as Record<string, unknown>;
  // dist-tag style: { "version": "1.2.3" } from /latest
  if (typeof obj.version === "string" && obj.version.trim()) {
    return obj.version.trim();
  }
  // full package doc: { "dist-tags": { "latest": "1.2.3" } }
  const tags = obj["dist-tags"];
  if (tags && typeof tags === "object" && !Array.isArray(tags)) {
    const latest = (tags as Record<string, unknown>).latest;
    if (typeof latest === "string" && latest.trim()) return latest.trim();
  }
  throw new Error("Could not find latest version in npm registry response");
}

export type UpdateCheckResult =
  | { status: "up-to-date"; current: string; latest: string }
  | { status: "update-available"; current: string; latest: string }
  | { status: "unknown"; current: string; reason: string };

export function evaluateUpdate(current: string, latest: string): UpdateCheckResult {
  const c = current.trim();
  const l = latest.trim();
  if (!parseSemverCore(c) || !parseSemverCore(l)) {
    return { status: "unknown", current: c, reason: "non-semver version string" };
  }
  if (isNewerVersion(l, c)) {
    return { status: "update-available", current: c, latest: l };
  }
  return { status: "up-to-date", current: c, latest: l };
}

/** Build the install command users / `gitgen update` should run. */
export function npmGlobalInstallCommand(packageName: string, version?: string): string {
  const spec = version ? `${packageName}@${version}` : `${packageName}@latest`;
  return `npm install -g ${spec}`;
}
