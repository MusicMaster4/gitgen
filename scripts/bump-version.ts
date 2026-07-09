/**
 * Bump package.json version (semver) and prepend an entry to CHANGELOG.md.
 *
 *   node --import tsx scripts/bump-version.ts patch|minor|major ["optional summary"]
 *   npm run version:patch
 *   npm run version:minor
 *   npm run version:major -- "short note"
 *
 * Source of truth: package.json "version". The CLI reads it via lib/version.ts.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = join(root, "package.json");
const changelogPath = join(root, "CHANGELOG.md");

type Part = "major" | "minor" | "patch";

function parseSemver(v: string): [number, number, number] {
  const m = v.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) throw new Error(`Invalid semver in package.json: "${v}"`);
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}

function bump(part: Part, current: string): string {
  let [maj, min, pat] = parseSemver(current);
  if (part === "major") {
    maj += 1;
    min = 0;
    pat = 0;
  } else if (part === "minor") {
    min += 1;
    pat = 0;
  } else {
    pat += 1;
  }
  return `${maj}.${min}.${pat}`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const part = (process.argv[2] || "").toLowerCase() as Part | "";
const summary = process.argv.slice(3).join(" ").trim();

if (part !== "major" && part !== "minor" && part !== "patch") {
  console.error(`Usage: npm run version:<part>  or  npx tsx scripts/bump-version.ts <major|minor|patch> ["summary"]`);
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string; [k: string]: unknown };
const previous = pkg.version;
const next = bump(part, previous);
pkg.version = next;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");

const lockPath = join(root, "package-lock.json");
if (existsSync(lockPath)) {
  const lock = JSON.parse(readFileSync(lockPath, "utf8")) as {
    version?: string;
    packages?: Record<string, { version?: string; [k: string]: unknown }>;
    [k: string]: unknown;
  };
  lock.version = next;
  if (lock.packages?.[""] && typeof lock.packages[""] === "object") {
    lock.packages[""].version = next;
  }
  writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n", "utf8");
}

const note = summary || `Bump ${part} (${previous} → ${next}).`;
const entry = `## ${next} — ${today()}\n\n- ${note}\n\n`;

let changelog: string;
if (existsSync(changelogPath)) {
  const existing = readFileSync(changelogPath, "utf8");
  const lines = existing.split(/\r?\n/);
  if (lines[0]?.startsWith("# ")) {
    const rest = existing.replace(/^# [^\n]*\n+/, "");
    changelog = `# Changelog\n\n${entry}${rest}`;
  } else {
    changelog = entry + existing;
  }
} else {
  changelog = `# Changelog\n\n${entry}`;
}
writeFileSync(changelogPath, changelog, "utf8");

console.log(`version: ${previous} → ${next}`);
console.log(`updated: package.json, CHANGELOG.md${existsSync(lockPath) ? ", package-lock.json" : ""}`);
console.log(`verify : gitgen version   (or: gg v)`);
