/**
 * Ensure dist/cli.js starts with a Node shebang (required for npm bin on Unix).
 */
import { readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(root, "dist", "cli.js");
const SHEBANG = "#!/usr/bin/env node\n";

let raw = readFileSync(cliPath, "utf8");
// Strip any leading shebang lines so we only have one at the top
raw = raw.replace(/^(#!.*\r?\n)+/, "");
writeFileSync(cliPath, SHEBANG + raw, "utf8");
try {
  chmodSync(cliPath, 0o755);
} catch {
  // Windows may not support chmod the same way — ignore
}
console.log("postbuild-cli: shebang applied to dist/cli.js");
