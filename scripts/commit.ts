#!/usr/bin/env bun
/**
 * gitgen commit  — add everything, generate an AI Conventional Commit, commit.
 * gitgen commit push — same, then push.
 *
 * Reuses the exact message-generation logic from the web app (lib/commit-message.ts),
 * so no server needs to be running. Reads provider/keys from the app's .env.local.
 *
 * Run:  bun scripts/commit.ts [push]
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import {
  CommitMessageError,
  DEFAULT_MODELS,
  PROVIDER_LABEL,
  type Provider,
  generateCommitMessage,
} from "../lib/commit-message";

const pexec = promisify(execFile);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cwd = process.cwd();

/** Minimal .env parser — no dependency, only KEY=VALUE lines. */
function loadEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return out;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

/** Run git and stream failures — used for the mutating steps (add/commit/push). */
async function runGit(args: string[]): Promise<string> {
  const { stdout } = await pexec("git", args, {
    cwd,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout;
}

function die(msg: string): never {
  console.error(`  error  : ${msg}`);
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2).map((a) => a.toLowerCase());
  const shouldPush = args.includes("push");

  // Env: process env first (so callers can override), then app .env.local.
  const env = { ...loadEnvFile(join(repoRoot, ".env.local")), ...process.env };

  const provider: Provider = (env.AI_PROVIDER || "").trim() === "openai" ? "openai" : "openrouter";
  const apiKey = (
    provider === "openai" ? env.OPENAI_API_KEY : env.OPENROUTER_API_KEY
  )?.trim() || "";
  const model =
    (provider === "openai" ? env.OPENAI_MODEL : env.OPENROUTER_MODEL)?.trim() ||
    DEFAULT_MODELS[provider];
  const language = (env.COMMIT_LANGUAGE || "").trim() === "pt" ? "pt" : "en";

  console.log("Git Command Generator — commit");
  console.log(`  folder : ${cwd}`);
  console.log(`  ai     : ${PROVIDER_LABEL[provider]} (${model})`);

  if (!apiKey) {
    die(`Set the ${PROVIDER_LABEL[provider]} API key in ${join(repoRoot, ".env.local")}`);
  }

  console.log("  ai     : generating commit message...");
  let message: string;
  try {
    message = await generateCommitMessage({ path: cwd, provider, apiKey, model, language });
  } catch (e) {
    if (e instanceof CommitMessageError) die(e.message);
    die(e instanceof Error ? e.message : String(e));
  }
  console.log(`  message: ${message}`);

  try {
    await runGit(["add", "-A"]);
    await runGit(["commit", "-m", message]);
    console.log("  commit : done");
    if (shouldPush) {
      console.log("  push   : pushing...");
      const out = await runGit(["push"]);
      if (out.trim()) console.log(out.trim());
      console.log("  push   : done");
    }
  } catch (e) {
    const stderr = (e as { stderr?: string })?.stderr;
    die(stderr?.trim() || (e instanceof Error ? e.message : String(e)));
  }
}

main();
