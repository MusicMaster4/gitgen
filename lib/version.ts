/**
 * App/CLI version — single source of truth is package.json "version".
 * Import this (or call getVersion) anywhere that needs to display the release.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageJsonPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");

let cached: string | undefined;

/** Semver string from package.json (e.g. "1.0.0"). Cached after first read. */
export function getVersion(): string {
  if (cached) return cached;
  try {
    const raw = readFileSync(packageJsonPath, "utf8");
    const pkg = JSON.parse(raw) as { version?: string };
    cached = (pkg.version || "0.0.0").trim() || "0.0.0";
  } catch {
    cached = "0.0.0";
  }
  return cached;
}

/** Name used in CLI banners / --version output. */
export const APP_NAME = "git-command-generator";
export const CLI_NAME = "gitgen";
