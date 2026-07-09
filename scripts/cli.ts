#!/usr/bin/env bun
/**
 * gitgen CLI — terminal equivalents of every workflow card in the web app.
 * Runs the git commands directly in the current folder (no server needed) and
 * reuses the app's AI message generator (lib/commit-message.ts).
 *
 * Reads provider/keys from the app's .env.local. Run:  bun scripts/cli.ts <cmd> [args]
 *
 *   commit [push] [-m msg]   add . -> (AI) commit [-> push]
 *   branch <name> [-m msg]   checkout -b -> add -> commit -> push -u origin <name>
 *   merge  <branch> [-m msg] add -> commit -> checkout main -> merge <branch> -> push
 *   save   [-m msg]          add -> commit -> checkout main (save state, back to main)
 *   switch <branch>          checkout <branch>
 *   remote <url> [-m msg]    git init -> remote add origin -> add -> commit -> push -u origin main
 *   restore [file] [-y]      git restore . (or a single file) — destructive
 *   help                     show this list
 */
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
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

/* ── env ── */
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

const env = { ...loadEnvFile(join(repoRoot, ".env.local")), ...process.env };
const provider: Provider = (env.AI_PROVIDER || "").trim() === "openai" ? "openai" : "openrouter";
const apiKey = ((provider === "openai" ? env.OPENAI_API_KEY : env.OPENROUTER_API_KEY) || "").trim();
const model =
  ((provider === "openai" ? env.OPENAI_MODEL : env.OPENROUTER_MODEL) || "").trim() ||
  DEFAULT_MODELS[provider];
const language: "en" | "pt" = (env.COMMIT_LANGUAGE || "").trim() === "pt" ? "pt" : "en";

/* ── helpers ── */
function log(msg: string) {
  console.log(msg);
}
function die(msg: string): never {
  console.error(`  error  : ${msg}`);
  process.exit(1);
}

/* ── live progress indicator ── */
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const BAR_WIDTH = 22;
const CLEAR_EOL = "\x1b[K"; // erase from cursor to end of line
const isTTY = Boolean(process.stdout.isTTY);
const secs = (start: number) => `${((Date.now() - start) / 1000).toFixed(1)}s`;

function bar(percent: number): string {
  const pct = Math.max(0, Math.min(100, percent));
  const filled = Math.round((pct / 100) * BAR_WIDTH);
  return `[${"█".repeat(filled)}${"░".repeat(BAR_WIDTH - filled)}] ${String(Math.round(pct)).padStart(3)}%`;
}

/**
 * If a git progress fragment carries a percentage (e.g. "Writing objects: 60% (12/20)")
 * render it as a real bar with the phase name; otherwise fall back to the raw text.
 */
function renderDetail(detail: string): string {
  const m = detail.match(/(\d{1,3})%/);
  if (m) {
    const phase = detail.split(":")[0].trim();
    return ` ${bar(parseInt(m[1], 10))}${phase ? ` ${phase}` : ""}`;
  }
  return detail ? ` — ${detail}` : "";
}

/**
 * Run an async step with a live one-line indicator: spinner + elapsed time, plus a
 * real progress bar whenever the step streams a percentage (git transfer progress).
 * Falls back to plain start/end lines when stdout isn't a TTY (piped/redirected).
 */
async function withProgress<T>(
  label: string,
  fn: (setDetail: (s: string) => void) => Promise<T>
): Promise<T> {
  const start = Date.now();
  let detail = "";
  let frame = 0;
  const setDetail = (s: string) => {
    detail = s.length > 70 ? s.slice(0, 67) + "…" : s;
  };
  const draw = () => {
    process.stdout.write(
      `\r  ${SPINNER[(frame = (frame + 1) % SPINNER.length)]} ${label}${renderDetail(detail)}  ${secs(start)}${CLEAR_EOL}`
    );
  };
  let timer: ReturnType<typeof setInterval> | undefined;
  if (isTTY) {
    process.stdout.write(`  · ${label}`);
    timer = setInterval(draw, 80);
  } else {
    log(`  · ${label} ...`);
  }
  const finish = (mark: string) => {
    if (timer) clearInterval(timer);
    if (isTTY) process.stdout.write(`\r  ${mark} ${label}  ${secs(start)}${CLEAR_EOL}\n`);
    else log(`  ${mark} ${label} (${secs(start)})`);
  };
  try {
    const result = await fn(setDetail);
    finish("✓");
    return result;
  } catch (e) {
    finish("✗");
    throw e;
  }
}

/** Run a git command with a live indicator; throws on non-zero exit (stderr on the error). */
async function git(args: string[], opts: { progress?: boolean } = {}): Promise<string> {
  // `--progress` forces git to emit transfer progress even when stderr isn't a TTY.
  const spawnArgs = opts.progress ? [args[0], "--progress", ...args.slice(1)] : args;
  const stdout = await withProgress(`git ${args.join(" ")}`, (setDetail) =>
    new Promise<string>((resolve, reject) => {
      const child = spawn("git", spawnArgs, { cwd, windowsHide: true });
      let out = "";
      let err = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => {
        err += d;
        // git writes progress with \r; surface the latest non-empty fragment live.
        const last = d.toString().split(/[\r\n]+/).filter(Boolean).pop();
        if (last) setDetail(last.trim());
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) return resolve(out);
        const e = new Error(`git ${args[0]} failed`) as Error & { stderr: string };
        e.stderr = (err.trim() || out.trim());
        reject(e);
      });
    })
  );
  // Show the useful summary lines, but drop git's per-file "create/delete/rename mode" noise.
  const summary = stdout
    .split("\n")
    .filter((l) => l.trim() && !/^\s*(create|delete|rename) mode /.test(l))
    .map((l) => `    ${l.trimEnd()}`)
    .join("\n");
  if (summary) log(summary);
  return stdout;
}

/** Read-only git; returns "" on failure. */
async function gitQuiet(args: string[]): Promise<string> {
  try {
    const { stdout } = await pexec("git", args, { cwd, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
    return stdout;
  } catch {
    return "";
  }
}

async function hasChanges(): Promise<boolean> {
  return (await gitQuiet(["status", "--porcelain", "-u"])).trim() !== "";
}

/** Resolve the commit message: explicit -m wins, else AI (if a key is set), else the default. */
async function resolveMessage(explicit: string | undefined, fallback: string): Promise<string> {
  if (explicit && explicit.trim()) return explicit.trim();
  if (apiKey) {
    try {
      const m = await withProgress(`AI commit message · ${PROVIDER_LABEL[provider]}`, () =>
        generateCommitMessage({ path: cwd, provider, apiKey, model, language })
      );
      log(`  message: ${m}`);
      return m;
    } catch (e) {
      const reason = e instanceof CommitMessageError ? e.message : e instanceof Error ? e.message : String(e);
      log(`  ai     : skipped (${reason}) — using default`);
      return fallback;
    }
  }
  log(`  message: ${fallback} (default — no API key)`);
  return fallback;
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`  ${question} (y/N) `)).trim().toLowerCase();
  rl.close();
  return answer === "y" || answer === "yes";
}

/** Wrap a sequence of mutating git steps with unified error reporting. */
async function runSteps(steps: () => Promise<void>): Promise<void> {
  try {
    await steps();
    log("  done   : ok");
  } catch (e) {
    const stderr = (e as { stderr?: string })?.stderr;
    die(stderr?.trim() || (e instanceof Error ? e.message : String(e)));
  }
}

/* ── arg parsing ── */
const argv = process.argv.slice(2);
let messageFlag: string | undefined;
let yes = false;
const positional: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "-m" || a === "--message") messageFlag = argv[++i];
  else if (a === "-y" || a === "--yes") yes = true;
  else positional.push(a);
}
const cmd = (positional[0] || "").toLowerCase();
const arg1 = positional[1];

const HELP = `gitgen — terminal git workflows (folder: ${cwd})

  gitgen commit [push] [-m "msg"]   add . -> commit [-> push]  (AI message if -m omitted)
  gitgen branch <name> [-m "msg"]   new branch -> add -> commit -> push -u origin <name>
  gitgen merge  <branch> [-m "msg"] commit -> checkout main -> merge <branch> -> push
  gitgen save   [-m "msg"]          commit current work, then checkout main
  gitgen switch <branch>            checkout <branch>
  gitgen remote <url> [-m "msg"]    git init -> remote add origin -> first push (main)
  gitgen restore [file] [-y]        discard changes (all, or one file) — destructive
  gitgen help                       show this list

AI: ${PROVIDER_LABEL[provider]} (${model})${apiKey ? "" : " — no API key set, defaults used"}`;

async function main() {
  switch (cmd) {
    case "":
    case "help":
    case "-h":
    case "--help":
      log(HELP);
      return;

    case "commit": {
      const push = (arg1 || "").toLowerCase() === "push";
      log(`Git Command Generator — commit${push ? " + push" : ""}`);
      log(`  folder : ${cwd}`);
      if (!(await hasChanges())) {
        log("  commit : nothing to commit — working tree clean");
        return;
      }
      const message = await resolveMessage(messageFlag, push ? "feat: update" : "feat: save progress");
      await runSteps(async () => {
        await git(["add", "."]);
        await git(["commit", "-m", message]);
        if (push) await git(["push"], { progress: true });
      });
      return;
    }

    case "branch": {
      const name = arg1;
      if (!name) die('branch name required — e.g. gitgen branch feature/login');
      log(`Git Command Generator — create branch ${name}`);
      log(`  folder : ${cwd}`);
      const message = await resolveMessage(messageFlag, "feat: new branch");
      await runSteps(async () => {
        await git(["checkout", "-b", name]);
        await git(["add", "."]);
        await git(["commit", "-m", message]);
        await git(["push", "-u", "origin", name], { progress: true });
      });
      return;
    }

    case "merge": {
      const target = arg1;
      if (!target) die('branch name required — e.g. gitgen merge feature/login');
      log(`Git Command Generator — merge ${target} into main`);
      log(`  folder : ${cwd}`);
      const message = await resolveMessage(messageFlag, `merge: integrate ${target} into main`);
      await runSteps(async () => {
        if (await hasChanges()) {
          await git(["add", "."]);
          await git(["commit", "-m", message]);
        }
        await git(["checkout", "main"]);
        await git(["merge", target]);
        await git(["push"], { progress: true });
      });
      return;
    }

    case "save": {
      log("Git Command Generator — save state and return to main");
      log(`  folder : ${cwd}`);
      const message = await resolveMessage(messageFlag, "wip: saving progress");
      await runSteps(async () => {
        if (await hasChanges()) {
          await git(["add", "."]);
          await git(["commit", "-m", message]);
        } else {
          log("  commit : nothing to commit — switching only");
        }
        await git(["checkout", "main"]);
      });
      return;
    }

    case "switch": {
      const target = arg1;
      if (!target) die('branch name required — e.g. gitgen switch main');
      log(`Git Command Generator — switch to ${target}`);
      log(`  folder : ${cwd}`);
      await runSteps(async () => {
        await git(["checkout", target]);
      });
      return;
    }

    case "remote": {
      const url = arg1;
      if (!url) die('repository URL required — e.g. gitgen remote https://github.com/me/repo.git');
      log(`Git Command Generator — add remote origin`);
      log(`  folder : ${cwd}`);
      await runSteps(async () => {
        await git(["init"]);
        await git(["remote", "add", "origin", url]);
        const message = await resolveMessage(messageFlag, "chore: initial commit");
        await git(["add", "."]);
        await git(["commit", "-m", message]);
        await git(["branch", "-M", "main"]);
        await git(["push", "-u", "origin", "main"], { progress: true });
      });
      return;
    }

    case "restore": {
      const file = arg1;
      const target = file ? file : ".";
      const what = file ? `file "${file}"` : "ALL uncommitted changes";
      log(`Git Command Generator — restore (${what})`);
      log(`  folder : ${cwd}`);
      if (!yes) {
        const ok = await confirm(`Destructive: this discards ${what} and cannot be undone. Continue?`);
        if (!ok) {
          log("  restore: aborted");
          return;
        }
      }
      await runSteps(async () => {
        await git(["restore", target]);
      });
      return;
    }

    default:
      die(`unknown command "${cmd}". Run "gitgen help" for the list.`);
  }
}

main();
