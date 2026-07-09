/**
 * App/CLI version — single source of truth is package.json "version".
 * Works from lib/ (dev) and dist/ (published bin): package.json is always one level up.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function packageJsonPathFrom(moduleUrl: string): string {
  return join(dirname(fileURLToPath(moduleUrl)), "..", "package.json");
}

const packageJsonPath = packageJsonPathFrom(import.meta.url);

type Pkg = { version?: string; name?: string };

function readPkg(): Pkg {
  try {
    return JSON.parse(readFileSync(packageJsonPath, "utf8")) as Pkg;
  } catch {
    return {};
  }
}

let cachedVersion: string | undefined;
let cachedName: string | undefined;

/** Semver string from package.json (e.g. "1.0.0"). Cached after first read. */
export function getVersion(): string {
  if (cachedVersion) return cachedVersion;
  cachedVersion = (readPkg().version || "0.0.0").trim() || "0.0.0";
  return cachedVersion;
}

/** npm package name used for publish / `gitgen update`. */
export function getPackageName(): string {
  if (cachedName) return cachedName;
  cachedName = (readPkg().name || "git-command-generator").trim() || "git-command-generator";
  return cachedName;
}

/** Reset caches (tests only). */
export function _resetVersionCacheForTests(): void {
  cachedVersion = undefined;
  cachedName = undefined;
}

/** Name used in CLI banners / --version output. */
export const APP_NAME = "git-command-generator";
export const CLI_NAME = "gitgen";
