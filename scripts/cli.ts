/**
 * gitgen / gg CLI — terminal equivalents of every workflow card in the web app.
 * Runs git in the current folder (no server needed) and reuses lib/commit-message.ts.
 *
 * Config: user-level OpenRouter settings (see lib/config.ts). Env overrides allowed.
 * Run:  node dist/cli.js <cmd>  |  gitgen <cmd>  |  git-gen <cmd>  |  gg <cmd>
 * Prefer npm global bins (npm install -g). Bare command = help; use `start` for the web UI.
 *
 * Long form              Short        What it does
 * ─────────────────────  ───────────  ──────────────────────────────────────────
 *   start                start        open the web app with current folder
 *   commit [push] [pr]   c [p] [pr]   add . -> (AI) commit [-> push] [-> PR]
 *   commit-and-push      cnp [pr]     add . -> (AI) commit -> push [-> PR]
 *   pr [base]            pr [base]    push branch -> AI title/body -> gh pr create
 *   branch <name>        b <name>     checkout -b -> add -> commit -> push -u
 *   merge  <src> [dst]   m <src> [d]  add -> commit -> checkout dst -> merge -> push
 *   save                 s            add -> commit -> checkout main
 *   switch <branch>      sw <branch>  checkout <branch>
 *   remote <url>         r <url>      init -> remote add origin -> first push
 *   restore [file]       rs [file]    git restore . (or one file) — destructive
 *   model [slug]         mo [slug]    show or switch the AI model
 *   setup / onboard      setup        OpenRouter onboard (hidden key + model + lang)
 *   config […|reset]     config       show/set config · reset = re-onboard
 *   update               u            check npm for a newer version / install
 *   version              v            print CLI / package version
 *   help                 h            show this list (also the default with no args)
 *
 * Security: the API key is entered hidden (never echoed) and written to a
 * user-only config file (0600). It stays local — only sent to OpenRouter.
 *
 * Flags: -m / --message "msg" · -y / --yes (skip restore confirm; PR uses default base)
 * Also: --version / -v / -V (same as version)
 * PR needs GitHub CLI (`gh`) authenticated (`gh auth login`).
 */
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createConnection } from "node:net";
import { promisify } from "node:util";
import { createInterface } from "node:readline/promises";
import { dirname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import {
  CommitMessageError,
  DEFAULT_MODELS,
  PROVIDER_LABEL,
  generateCommitMessage,
} from "../lib/commit-message";
import {
  DEFAULT_OPENROUTER_MODEL,
  type CommitLanguage,
  type GitgenConfig,
  getConfigPath,
  loadConfig,
  looksLikeOpenRouterKey,
  maskApiKey,
  resolveRuntimeSettings,
  saveConfig,
} from "../lib/config";
import {
  detectDefaultBase,
  fallbackPrContent,
  generatePrContent,
  isGhAvailable,
  PrMessageError,
  runCapture,
  type PrContent,
} from "../lib/pr-message";
import {
  evaluateUpdate,
  npmGlobalInstallCommand,
  parseNpmLatestVersion,
} from "../lib/update-check";
import { APP_NAME, CLI_NAME, getPackageName, getVersion } from "../lib/version";
import { c, header, row, sym, visibleLength } from "../lib/ui";

const pexec = promisify(execFile);

/**
 * Package root for this CLI.
 * Prefer process.argv[1] (the path npm put on PATH) over import.meta.url:
 * `npm install -g .` creates a junction/symlink, and import.meta.url realpath
 * would show the clone (H:\…) instead of the npm install dir.
 */
function resolvePackageRoot(): string {
  const entry = process.argv[1] ? normalize(process.argv[1]) : "";
  if (entry) {
    const entryDir = dirname(entry);
    // Published / built layout: <package>/dist/cli.js
    if (entryDir.endsWith(`${sep}dist`) || /[\\/]dist$/i.test(entryDir)) {
      return join(entryDir, "..");
    }
    // Dev: tsx scripts/cli.ts → package root is parent of scripts/
    if (entryDir.endsWith(`${sep}scripts`) || /[\\/]scripts$/i.test(entryDir)) {
      return join(entryDir, "..");
    }
  }
  // Fallback (bundled): dist/ → package root
  return join(dirname(fileURLToPath(import.meta.url)), "..");
}

const packageRoot = resolvePackageRoot();
const cwd = process.cwd();

const PROVIDER = "openrouter" as const;

/* ── helpers ── */
function log(msg: string) {
  console.log(msg);
}
function die(msg: string): never {
  console.error(`  ${sym.fail} ${c.red("error")}  ${c.dim(msg)}`);
  process.exit(1);
}
function warn(msg: string) {
  log(`  ${sym.warn} ${c.yellow(msg)}`);
}
/** Command banner: bold action title + the folder it runs in. */
function banner(action: string) {
  log(`\n  ${c.bold(c.cyan("gitgen"))} ${c.dim("·")} ${c.bold(action)}`);
  log(`  ${c.dim("folder")} ${c.dim(cwd)}`);
}

function readUserConfig(): GitgenConfig {
  return loadConfig(getConfigPath());
}

function currentSettings(): {
  apiKey: string;
  model: string;
  language: CommitLanguage;
  configPath: string;
} {
  const configPath = getConfigPath();
  const file = loadConfig(configPath);
  const { apiKey, model, language } = resolveRuntimeSettings(file, process.env);
  return { apiKey, model, language, configPath };
}

/* ── live progress indicator ── */
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const BAR_WIDTH = 14;
// When launched through PowerShell/cmd, node often can't see the console and
// report isTTY=undefined. The launcher sets GCG_TTY=1 when it knows it's interactive.
// Clear with plain \r + spaces (no ANSI) so it still works without VT mode.
const animate = Boolean(process.stdout.isTTY) || process.env.GCG_TTY === "1";
const secs = (start: number) => `${((Date.now() - start) / 1000).toFixed(1)}s`;
/** Cap line length so \r overwrite never wraps (wrap = garble on Windows). */
const termCols = () => Math.max(40, Math.min(process.stdout.columns || 80, 100));

function bar(percent: number): string {
  const pct = Math.max(0, Math.min(100, percent));
  const filled = Math.round((pct / 100) * BAR_WIDTH);
  return `[${"█".repeat(filled)}${"░".repeat(BAR_WIDTH - filled)}] ${String(Math.round(pct)).padStart(3)}%`;
}

/**
 * Short spinner label — never include `-m <message>` or long argv.
 * Long labels wrap the live line; wrap + \r is what made the CLI look bloated.
 */
function gitLabel(args: string[]): string {
  const cmd = args[0] || "git";
  if (cmd === "checkout" && args[1] === "-b" && args[2]) return `git checkout -b ${args[2]}`;
  if (cmd === "checkout" && args[1]) return `git checkout ${args[1]}`;
  if (cmd === "push" && args.includes("-u")) return "git push -u";
  if (cmd === "merge" && args[1]) return `git merge ${args[1]}`;
  if (cmd === "restore" && args[1] && args[1] !== ".") return `git restore ${args[1]}`;
  if (cmd === "remote" && args[1] === "add") return "git remote add";
  if (cmd === "branch" && args[1] === "-M") return "git branch -M";
  return `git ${cmd}`;
}

/**
 * Percent phases only (Counting/Writing objects…). Drop "Total 13 (delta…)",
 * "remote: …" and other non-% spam that used to pile onto one line.
 */
function renderDetail(detail: string): string {
  const m = detail.match(/(\d{1,3})%/);
  if (!m) return "";
  const phase = detail.split(":")[0].trim().replace(/\s+/g, " ");
  const short = (phase.split(/\s+/)[0] || phase).slice(0, 12);
  return ` ${bar(parseInt(m[1], 10))} ${short}`;
}

/**
 * Live one-line step: spinner + time, optional compact transfer bar.
 * Non-TTY: plain start/end lines (sparse % milestones only).
 */
async function withProgress<T>(
  label: string,
  fn: (setDetail: (s: string) => void) => Promise<T>
): Promise<T> {
  const start = Date.now();
  let detail = "";
  let frame = 0;
  let lastPhase = "";
  let lastMilestone = -1;
  const setDetail = (s: string) => {
    // Ignore anything without a % — that's most of the push "bloat".
    if (!/\d{1,3}%/.test(s)) return;
    detail = s;
    if (animate) return;
    const m = s.match(/(\d{1,3})%/);
    if (!m) return;
    const phase = s.split(":")[0].trim();
    const pct = parseInt(m[1], 10);
    if (phase !== lastPhase) {
      lastPhase = phase;
      lastMilestone = -1;
    }
    if (pct >= lastMilestone + 50 || pct === 100) {
      lastMilestone = pct;
      log(`    ${renderDetail(s).trim()}`);
    }
  };
  // Full-width clear then write; truncate on VISIBLE width so ANSI-colored
  // lines never wrap (wrap + \r is what garbles the CLI on Windows).
  const paint = (content: string, newline = false) => {
    const cols = termCols();
    const max = cols - 1;
    const line =
      visibleLength(content) > max ? `${content.slice(0, Math.max(1, max - 1))}…` : content;
    process.stdout.write(`\r${" ".repeat(max)}\r${line}${newline ? "\n" : ""}`);
  };
  const draw = () => {
    const spin = c.cyan(SPINNER[(frame = (frame + 1) % SPINNER.length)]);
    paint(`  ${spin} ${label}${renderDetail(detail)}  ${c.dim(secs(start))}`);
  };
  let timer: ReturnType<typeof setInterval> | undefined;
  if (animate) {
    draw();
    timer = setInterval(draw, 100);
  } else {
    log(`  ${sym.info} ${label}`);
  }
  const finish = (mark: string) => {
    if (timer) clearInterval(timer);
    const line = `  ${mark} ${label}  ${c.dim(secs(start))}`;
    if (animate) paint(line, true);
    else log(line);
  };
  try {
    const result = await fn(setDetail);
    finish(sym.ok);
    return result;
  } catch (e) {
    finish(sym.fail);
    throw e;
  }
}

async function git(args: string[], opts: { progress?: boolean } = {}): Promise<string> {
  // `--progress` forces git to emit transfer % even when stderr isn't a TTY.
  const spawnArgs = opts.progress ? [args[0], "--progress", ...args.slice(1)] : args;
  const stdout = await withProgress(gitLabel(args), (setDetail) =>
    new Promise<string>((resolve, reject) => {
      const child = spawn("git", spawnArgs, { cwd, windowsHide: true });
      let out = "";
      let err = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => {
        err += d;
        // Only forward the latest fragment; setDetail drops non-% noise.
        const last = d.toString().split(/[\r\n]+/).filter(Boolean).pop();
        if (last) setDetail(last.trim());
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) return resolve(out);
        const e = new Error(`git ${args[0]} failed`) as Error & { stderr: string };
        e.stderr = err.trim() || out.trim();
        reject(e);
      });
    })
  );
  // Short summary: drop mode lines and per-file "| N +++" noise from commit.
  const summary = stdout
    .split("\n")
    .map((l) => l.trimEnd())
    .filter(
      (l) =>
        l.trim() &&
        !/^\s*(create|delete|rename) mode /.test(l) &&
        !/^\s+\S.*\|/.test(l)
    )
    .map((l) => `    ${c.dim(l.trim())}`)
    .join("\n");
  if (summary) log(summary);
  return stdout;
}

async function gitQuiet(args: string[]): Promise<string> {
  try {
    const { stdout } = await pexec("git", args, {
      cwd,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    });
    return stdout;
  } catch {
    return "";
  }
}

async function hasChanges(): Promise<boolean> {
  return (await gitQuiet(["status", "--porcelain", "-u"])).trim() !== "";
}

async function currentBranch(): Promise<string> {
  const name = (await gitQuiet(["branch", "--show-current"])).trim();
  if (!name) die("detached HEAD — checkout a branch before creating a PR");
  return name;
}

/** True when the current branch has an upstream configured. */
async function hasUpstream(): Promise<boolean> {
  const up = (await gitQuiet(["rev-parse", "--abbrev-ref", "@{upstream}"])).trim();
  return Boolean(up);
}

function isPrToken(t: string | undefined): boolean {
  const v = (t || "").toLowerCase();
  return v === "pr" || v === "pull" || v === "pull-request";
}

/**
 * After a commit/push command, detect trailing `pr [base]`.
 * Examples: cnp pr · cnp pr develop · commit push pr · commit pr main
 */
function parseCommitPrArgs(
  raw: string,
  a1: string | undefined,
  a2: string | undefined,
  a3: string | undefined
): { push: boolean; wantPr: boolean; prBase?: string } {
  const pushByAlias = PUSH_ALIASES.has(raw);
  // cnp [pr [base]]
  if (pushByAlias) {
    if (isPrToken(a1)) return { push: true, wantPr: true, prBase: a2 };
    return { push: true, wantPr: false };
  }
  // commit push pr [base]  |  commit p pr [base]
  if (isPushToken(a1)) {
    if (isPrToken(a2)) return { push: true, wantPr: true, prBase: a3 };
    return { push: true, wantPr: false };
  }
  // commit pr [base]  (implies push — you can't open a remote PR without push)
  if (isPrToken(a1)) return { push: true, wantPr: true, prBase: a2 };
  return { push: false, wantPr: false };
}

/** AI PR title/body, with sensible fallback if no key / API error. */
async function resolvePrContent(base: string, head: string): Promise<PrContent> {
  const { apiKey, model, language } = await ensureApiReady();
  if (apiKey) {
    try {
      // Two model calls (title, body) in parallel — plain text, no JSON.
      const content = await withProgress(
        `AI PR title + body · ${PROVIDER_LABEL[PROVIDER]}`,
        () =>
          generatePrContent({
            path: cwd,
            base,
            head,
            provider: PROVIDER,
            apiKey,
            model: model || DEFAULT_MODELS.openrouter,
            language,
          })
      );
      return content;
    } catch (e) {
      const reason =
        e instanceof PrMessageError || e instanceof CommitMessageError
          ? e.message
          : e instanceof Error
            ? e.message
            : String(e);
      log(`  ${sym.warn} ${c.yellow("ai skipped")} ${c.dim(`(${reason}) — using commit log`)}`);
    }
  } else {
    log(`  ${c.dim("PR text from git log")} ${c.dim("(no API key)")}`);
  }
  return fallbackPrContent(cwd, base, head);
}

type ExistingPr = { url: string; number: number; base: string };

/** Open PR for this head branch, if any (one feature branch → one open PR). */
async function findOpenPrForHead(head: string): Promise<ExistingPr | null> {
  try {
    const out = (
      await runCapture(
        "gh",
        [
          "pr",
          "list",
          "--head",
          head,
          "--state",
          "open",
          "--json",
          "url,number,baseRefName",
          "--limit",
          "5",
        ],
        cwd
      )
    ).trim();
    const list = JSON.parse(out || "[]") as Array<{
      url?: string;
      number?: number;
      baseRefName?: string;
    }>;
    if (!Array.isArray(list) || list.length === 0) return null;
    const first = list[0];
    if (!first?.url) return null;
    return {
      url: first.url,
      number: typeof first.number === "number" ? first.number : 0,
      base: first.baseRefName || "",
    };
  } catch {
    return null;
  }
}

/**
 * Push current branch (set upstream if needed), generate AI PR text, create via `gh`.
 * Creates immediately — no extra confirm (the command itself is the intent).
 * If this head already has an open PR, push only and reuse that PR (no second create).
 * `baseHint` is optional; interactive prompt defaults to origin's default branch
 * (or uses the default when `-y` is set).
 */
async function createPullRequest(baseHint?: string): Promise<void> {
  if (!(await isGhAvailable())) {
    die(
      "GitHub CLI (gh) not found — install https://cli.github.com and run: gh auth login"
    );
  }

  const head = await currentBranch();
  const defaultBase = await detectDefaultBase(cwd);
  let base = (baseHint || "").trim();
  if (!base) {
    if (yes) {
      base = defaultBase;
    } else {
      base = await promptLine("Base branch (merge target)", defaultBase);
    }
  }
  if (!base) die("base branch required");
  if (base === head) {
    die(`base and head are both "${head}" — checkout a feature branch first`);
  }

  // Ensure remote has our commits
  if (await hasUpstream()) {
    await git(["push"], { progress: true });
  } else {
    await git(["push", "-u", "origin", head], { progress: true });
  }

  // Same head already has an open PR → just update via push; don't create another.
  const existing = await withProgress("check existing PR", () => findOpenPrForHead(head));
  if (existing) {
    log(`  ${sym.ok} ${c.green("PR already open")} ${c.dim(`#${existing.number || "?"}`)}`);
    log(row("base", existing.base || base));
    log(row("head", head));
    log(row("url", c.underline(c.cyan(existing.url))));
    log(`  ${c.dim("skipped create — push updated the existing PR")}`);
    return;
  }

  const content = await resolvePrContent(base, head);
  log(row("base", base));
  log(row("head", head));
  log(row("title", c.bold(content.title)));
  // Preview body (compact) while gh creates the PR
  const preview = content.body
    .split("\n")
    .slice(0, 12)
    .map((l) => `    ${c.dim(l)}`)
    .join("\n");
  if (preview) {
    log(`  ${c.dim("body")}`);
    log(preview);
    if (content.body.split("\n").length > 12) log(`    ${c.dim("…")}`);
  }

  const url = (
    await withProgress("gh pr create", () =>
      runCapture(
        "gh",
        [
          "pr",
          "create",
          "--base",
          base,
          "--head",
          head,
          "--title",
          content.title,
          "--body",
          content.body,
        ],
        cwd
      )
    )
  )
    .trim()
    .split("\n")
    .filter(Boolean)
    .pop();

  if (url) {
    log(row("url", c.underline(c.cyan(url))));
  }
}

async function promptLine(question: string, defaultValue?: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const hint = defaultValue ? ` ${c.dim(`[${defaultValue}]`)}` : "";
  const answer = (await rl.question(`  ${c.bold(question)}${hint}\n  ${c.cyan("›")} `)).trim();
  rl.close();
  return answer || defaultValue || "";
}

/**
 * Read a secret (API key) WITHOUT echoing it to the terminal.
 * Prints a • per character so length is visible, but the value never lands in
 * terminal scrollback, tmux/screen capture, or the shell's screen buffer.
 * Requires a raw-capable TTY; otherwise falls back to a plain prompt.
 */
async function promptSecret(question: string, defaultValue?: string): Promise<string> {
  const input = process.stdin;
  if (!input.isTTY || typeof input.setRawMode !== "function") {
    // Non-raw stream (rare): can't hide input; keep the plain prompt.
    return promptLine(question, defaultValue);
  }
  const hint = defaultValue ? ` ${c.dim(`[${defaultValue}]`)}` : "";
  process.stdout.write(`  ${c.bold(question)}${hint}\n  ${c.cyan("›")} `);

  return new Promise<string>((resolve, reject) => {
    let value = "";
    const wasRaw = input.isRaw ?? false;
    input.setRawMode(true);
    input.resume();
    input.setEncoding("utf8");

    const cleanup = () => {
      input.setRawMode(wasRaw);
      input.pause();
      input.removeListener("data", onData);
      process.stdout.write("\n");
    };
    const onData = (chunk: string) => {
      // Ignore escape sequences (arrow/function keys) so "[A" etc. never leak
      // into the value: they arrive as a chunk that starts with the ESC byte (0x1b).
      if (chunk.charCodeAt(0) === 0x1b) return;
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          cleanup();
          resolve(value.trim() || defaultValue || "");
          return;
        }
        if (ch === "\u0003") {
          // Ctrl-C — abort like a normal SIGINT.
          cleanup();
          process.exit(130);
        }
        if (ch === "\u007f" || ch === "\b") {
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }
        if (ch === "\u0015") {
          // Ctrl-U — clear the whole line.
          if (value.length > 0) {
            process.stdout.write("\b \b".repeat(value.length));
            value = "";
          }
          continue;
        }
        if (ch < " ") continue; // ignore remaining control chars
        value += ch;
        process.stdout.write(c.dim("•"));
      }
    };
    input.on("data", onData);
    input.once("error", (e) => {
      cleanup();
      reject(e);
    });
  });
}

/** Interactive OpenRouter-only onboard. */
async function runSetup(existing?: GitgenConfig): Promise<GitgenConfig> {
  log(header(`${CLI_NAME} setup · OpenRouter`));
  log(`  ${c.dim("Get a key at")} ${c.underline(c.cyan("https://openrouter.ai/keys"))}`);
  log(`  ${c.dim("Input is hidden — the key is written to a private, owner-only file.")}`);
  log("");

  const prev = existing || readUserConfig();
  const key = await promptSecret(
    "OpenRouter API key",
    prev.openRouterApiKey ? maskApiKey(prev.openRouterApiKey) : undefined
  );
  // If user left mask placeholder, keep previous key
  let openRouterApiKey = key;
  if (prev.openRouterApiKey && (key === maskApiKey(prev.openRouterApiKey) || !key)) {
    openRouterApiKey = prev.openRouterApiKey;
  }
  if (!openRouterApiKey || openRouterApiKey.includes("…")) {
    // empty or still masked without previous
    if (!prev.openRouterApiKey) die("OpenRouter API key is required");
    openRouterApiKey = prev.openRouterApiKey;
  }
  // Typo guard — never blocks, just flags an obviously-wrong key before saving.
  if (!looksLikeOpenRouterKey(openRouterApiKey)) {
    warn("that doesn't look like an OpenRouter key (expected sk-or-…) — saving anyway");
  }

  const model =
    (await promptLine("Model (OpenRouter slug)", prev.model || DEFAULT_OPENROUTER_MODEL)) ||
    DEFAULT_OPENROUTER_MODEL;

  const langRaw = (
    await promptLine("Language (en|pt)", prev.language || "en")
  ).toLowerCase();
  const language: CommitLanguage = langRaw === "pt" ? "pt" : "en";

  const next: GitgenConfig = { openRouterApiKey, model, language };
  const path = getConfigPath();
  saveConfig(next, path);
  log("");
  log(`  ${sym.ok} ${c.green("Saved")} ${c.dim(path)}`);
  log(row("key", c.dim(maskApiKey(openRouterApiKey))));
  log(row("model", model));
  log(row("lang", language));
  log("");
  return next;
}

/**
 * Ensure we have an API key for AI messages.
 * First AI use without a key runs setup when stdin is a TTY.
 */
async function ensureApiReady(): Promise<{
  apiKey: string;
  model: string;
  language: CommitLanguage;
}> {
  let { apiKey, model, language, configPath } = currentSettings();
  if (apiKey) return { apiKey, model, language };

  const interactive =
    Boolean(process.stdin.isTTY) || process.env.GCG_TTY === "1" || Boolean(process.stdout.isTTY);
  if (!interactive) {
    return { apiKey: "", model, language };
  }

  log(`  ${sym.warn} ${c.yellow("No OpenRouter API key found")} ${c.dim(`(${configPath})`)}`);
  log(`  ${c.dim("Starting first-time setup…")}`);
  const saved = await runSetup(readUserConfig());
  const resolved = resolveRuntimeSettings(saved, process.env);
  return resolved;
}

/** Resolve the commit message: explicit -m wins, else AI (if a key is set), else the default. */
async function resolveMessage(explicit: string | undefined, fallback: string): Promise<string> {
  if (explicit && explicit.trim()) return explicit.trim();

  const { apiKey, model, language } = await ensureApiReady();
  if (apiKey) {
    try {
      const m = await withProgress(`AI commit message · ${PROVIDER_LABEL[PROVIDER]}`, () =>
        generateCommitMessage({
          path: cwd,
          provider: PROVIDER,
          apiKey,
          model: model || DEFAULT_MODELS.openrouter,
          language,
        })
      );
      log(`  ${c.dim("message")} ${c.bold(m)}`);
      return m;
    } catch (e) {
      const reason =
        e instanceof CommitMessageError
          ? e.message
          : e instanceof Error
            ? e.message
            : String(e);
      log(`  ${sym.warn} ${c.yellow("ai skipped")} ${c.dim(`(${reason}) — using default`)}`);
      return fallback;
    }
  }
  log(`  ${c.dim("message")} ${c.bold(fallback)} ${c.dim("(default — no API key)")}`);
  return fallback;
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`  ${c.yellow(question)} ${c.dim("(y/N)")} `)).trim().toLowerCase();
  rl.close();
  return answer === "y" || answer === "yes";
}

async function runSteps(steps: () => Promise<void>): Promise<void> {
  try {
    await steps();
    log(`  ${sym.ok} ${c.green("done")}`);
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

const SHORT_CMDS: Record<string, string> = {
  c: "commit",
  cnp: "commit", // commit AND push in one word (implies push — see PUSH_ALIASES)
  pr: "pr",
  pull: "pr",
  "pull-request": "pr",
  b: "branch",
  m: "merge",
  s: "save",
  sw: "switch",
  r: "remote",
  rs: "restore",
  mo: "model",
  v: "version",
  h: "help",
  u: "update",
  onboard: "setup",
};

// Commands whose very name means "…and push" (no separate push token needed).
const PUSH_ALIASES = new Set(["cnp"]);

const rawCmd = (positional[0] || "").toLowerCase();
const cmd = SHORT_CMDS[rawCmd] || rawCmd;
const arg1 = positional[1];
const arg2 = positional[2];
const arg3 = positional[3];

function isPushToken(t: string | undefined): boolean {
  const v = (t || "").toLowerCase();
  return v === "push" || v === "p";
}

/** Where this CLI is installed (npm global prefix, local clone, etc.). */
function installPaths(): {
  packageRoot: string;
  entry: string;
  configPath: string;
} {
  return {
    packageRoot,
    entry: process.argv[1] || "",
    configPath: getConfigPath(),
  };
}

function printInstallDetails(): void {
  const { packageRoot: root, entry, configPath } = installPaths();
  log(row("version", getVersion()));
  log(row("package", getPackageName()));
  log(row("install", c.dim(root)));
  if (entry) log(row("entry", c.dim(entry)));
  log(row("config", c.dim(configPath)));
  log(row("bins", c.dim("gitgen · git-gen · gg  (npm global PATH)")));
  log(`  ${c.dim("update")} ${c.cyan(`npm install -g ${getPackageName()}`)}  ${c.dim("or")} ${c.cyan("gitgen update")}`);
}

function openBrowser(url: string): void {
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    return;
  }
  if (process.platform === "darwin") {
    spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
}

function testLocalPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const done = (ok: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(300);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

/**
 * Open the web app for the current folder.
 * - Full checkout: uses scripts/open-here (can start `npm run dev`).
 * - npm global install: opens the browser if the server is already up.
 */
async function openApp(): Promise<void> {
  const port = process.env.GCG_PORT || "2001";
  const openHerePs1 = join(packageRoot, "scripts", "open-here.ps1");
  const openHereMjs = join(packageRoot, "scripts", "open-here.mjs");
  const hasDevLauncher =
    process.platform === "win32" ? existsSync(openHerePs1) : existsSync(openHereMjs);

  banner("start web app");

  if (hasDevLauncher) {
    log(`  ${c.dim("note   full checkout — may start npm run dev if offline")}`);
    await new Promise<void>((resolve, reject) => {
      const child =
        process.platform === "win32"
          ? spawn(
              "powershell",
              [
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                openHerePs1,
                "-Port",
                port,
              ],
              { stdio: "inherit", cwd, windowsHide: true }
            )
          : spawn(process.execPath, [openHereMjs], {
              stdio: "inherit",
              cwd,
              env: { ...process.env, GCG_PORT: port },
            });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve();
        else process.exit(code ?? 1);
      });
    });
    return;
  }

  // Published npm package has no scripts/ — only open the browser if the UI is up.
  const url = `http://localhost:${port}/?path=${encodeURIComponent(cwd)}`;
  log(row("url", c.dim(url)));
  log(row("cli", c.dim(packageRoot)));
  if (await testLocalPort(Number(port))) {
    log(`  ${sym.ok} ${c.green("server online")} ${c.dim(`:${port}`)}`);
    openBrowser(url);
    log(`  ${sym.ok} ${c.green("opened browser")}`);
    return;
  }
  log(`  ${sym.warn} ${c.yellow(`no server on :${port}`)}`);
  log(`  ${c.dim("The CLI package is npm-only. Web UI needs a full clone:")}`);
  log(`  ${c.dim("  git clone <repo> && npm install && npm run dev")}`);
  log(`  ${c.dim("Then:")} ${c.cyan("gitgen start")}  ${c.dim("or open")} ${c.underline(c.cyan(url))}`);
  process.exitCode = 1;
}

async function cmdConfig(): Promise<void> {
  const sub = (arg1 || "show").toLowerCase();
  const path = getConfigPath();
  const file = loadConfig(path);
  const runtime = resolveRuntimeSettings(file, process.env);

  if (sub === "show" || sub === "") {
    log(header(`${CLI_NAME} config`));
    log(row("path", c.dim(path)));
    log(row("key", runtime.apiKey ? c.dim(maskApiKey(runtime.apiKey)) : c.yellow("(not set)")));
    log(row("model", runtime.model));
    log(row("lang", runtime.language));
    log(row("source", c.dim(process.env.OPENROUTER_API_KEY ? "env (+ file)" : "config file")));
    return;
  }

  if (sub === "set") {
    const field = (arg2 || "").toLowerCase();
    const value = arg3;
    if (!field || value === undefined) {
      die("usage: gitgen config set <model|key|language> <value>");
    }
    const next: GitgenConfig = { ...file };
    if (field === "model") next.model = value;
    else if (field === "key" || field === "apikey" || field === "api-key") {
      next.openRouterApiKey = value;
      if (!looksLikeOpenRouterKey(value)) {
        warn("that doesn't look like an OpenRouter key (expected sk-or-…) — saving anyway");
      }
    } else if (field === "language" || field === "lang") {
      next.language = value.toLowerCase() === "pt" ? "pt" : "en";
    } else {
      die(`unknown field "${field}" — use model, key, or language`);
    }
    saveConfig(next, path);
    const shown = field === "key" || field === "apikey" || field === "api-key" ? maskApiKey(value) : value;
    log(`  ${sym.ok} ${c.green(`updated ${field}`)} ${c.dim("→")} ${shown}`);
    return;
  }

  if (sub === "reset") {
    // Full re-onboard: overwrites the config with fresh, owner-only values.
    log(`  ${c.dim("Re-running the full onboard — this overwrites the saved config.")}`);
    await runSetup(file);
    return;
  }

  if (sub === "path") {
    log(path);
    return;
  }

  die(`unknown config subcommand "${sub}" — use show | set | path | reset`);
}

/** Quick model switch: `gg model <slug>` (or `gg mo <slug>`); no arg prints current. */
async function cmdModel(): Promise<void> {
  const path = getConfigPath();
  const file = loadConfig(path);
  const slug = arg1?.trim();
  if (!slug) {
    const { model } = resolveRuntimeSettings(file, process.env);
    log(header(`${CLI_NAME} model`));
    log(row("current", model));
    log(`  ${c.dim("change it:")} ${c.cyan("gg model <openrouter-slug>")}`);
    log(`  ${c.dim("browse   :")} ${c.underline(c.cyan("https://openrouter.ai/models"))}`);
    return;
  }
  saveConfig({ ...file, model: slug }, path);
  log(`  ${sym.ok} ${c.green("model set")} ${c.dim("→")} ${c.bold(slug)}`);
}

async function fetchLatestFromNpm(packageName: string): Promise<string> {
  const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`npm registry HTTP ${res.status} for ${packageName}`);
  }
  const json: unknown = await res.json();
  return parseNpmLatestVersion(json);
}

async function cmdUpdate(): Promise<void> {
  const packageName = getPackageName();
  const current = getVersion();
  log(header(`${CLI_NAME} update`));
  log(row("package", packageName));
  log(row("current", current));

  let latest: string;
  try {
    latest = await withProgress("check npm registry", () => fetchLatestFromNpm(packageName));
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    log(`  ${sym.warn} ${c.yellow("could not check registry")} ${c.dim(`(${reason})`)}`);
    log(`  ${c.dim("tip")} ${npmGlobalInstallCommand(packageName)}`);
    process.exitCode = 1;
    return;
  }

  const result = evaluateUpdate(current, latest);
  if (result.status === "up-to-date") {
    log(row("latest", latest));
    log(`  ${sym.ok} ${c.green("already up to date")}`);
    return;
  }
  if (result.status === "unknown") {
    log(row("latest", latest));
    log(row("status", c.yellow(result.reason)));
    log(`  ${c.dim("tip")} ${npmGlobalInstallCommand(packageName, latest)}`);
    return;
  }

  log(row("latest", c.green(latest)));
  log(`  ${sym.warn} ${c.yellow("update available")}`);
  const installCmd = npmGlobalInstallCommand(packageName, latest);
  log(`  ${c.dim("running")} ${installCmd}`);

  await new Promise<void>((resolve) => {
    const child = spawn("npm", ["install", "-g", `${packageName}@${latest}`], {
      stdio: "inherit",
      shell: true,
      windowsHide: true,
    });
    child.on("error", (err) => {
      log(`  ${sym.fail} ${c.red(err.message)}`);
      log(`  ${c.dim("tip")} run manually: ${installCmd}`);
      process.exitCode = 1;
      resolve();
    });
    child.on("close", (code) => {
      if (code === 0) {
        log(`  ${sym.ok} ${c.green(`installed ${packageName}@${latest}`)}`);
        log(`  ${c.dim("verify")} ${CLI_NAME} version`);
      } else {
        log(`  ${sym.fail} ${c.red(`npm exited with code ${code ?? "?"}`)}`);
        log(`  ${c.dim("tip")} ${installCmd}`);
        process.exitCode = code ?? 1;
      }
      resolve();
    });
  });
}

function helpText(): string {
  const { apiKey, model } = currentSettings();
  const { packageRoot: root } = installPaths();
  const d = c.dim;
  const rows: Array<[string, string, string]> = [
    ["start", "start", "open the web app with this folder"],
    ["commit [push] [pr] [-m]", "c [p] [pr] [-m]", "add . → commit [→ push] [→ PR]"],
    ["commit-and-push [pr]", "cnp [pr]", "add . → commit → push [→ AI PR via gh]"],
    ["pr [base] [-y]", "pr [base]", "push → AI title/body → create PR (asks base)"],
    ["branch <name> [-m]", "b <name> [-m]", "new branch → add → commit → push -u"],
    ["merge <src> [dst] [-m]", "m <src> [dst]", "commit → checkout dst|main → merge → push"],
    ["save [-m]", "s [-m]", "commit current work, then checkout main"],
    ["switch <branch>", "sw <branch>", "checkout <branch>"],
    ["remote <url> [-m]", "r <url> [-m]", "git init → remote add origin → first push"],
    ["restore [file] [-y]", "rs [file] [-y]", "discard changes (all, or one file)"],
    ["model [slug]", "mo [slug]", "show or switch the AI model"],
    ["setup / onboard", "setup", "OpenRouter onboard (hidden key + model)"],
    ["config [show|set|path|reset]", "config", "show/set config · reset = re-onboard"],
    ["update", "u", "check npm / install latest"],
    ["version", "v", "print version + install path"],
    ["help", "h", "show this list (default if no command)"],
  ];
  const longW = Math.max(...rows.map((r) => r[0].length));
  const shortW = Math.max(...rows.map((r) => r[1].length));
  const body = rows
    .map(([l, s, a]) => `  ${c.cyan(l.padEnd(longW))}  ${d(s.padEnd(shortW))}  ${a}`)
    .join("\n");

  return `
  ${c.bold(c.cyan("gitgen / git-gen / gg"))} ${d("— terminal git workflows")}
  ${d(`v${getVersion()} · ${APP_NAME}`)}
  ${d("folder")} ${d(cwd)}
  ${d("install")} ${d(root)}

  ${c.bold("Long".padEnd(longW))}  ${c.bold("Short".padEnd(shortW))}  ${c.bold("Action")}
  ${d("─".repeat(longW))}  ${d("─".repeat(shortW))}  ${d("─".repeat(42))}
${body}

  ${c.bold("Examples")}
    ${d("$")} npm install -g ${getPackageName()}
    ${d("$")} gitgen version         ${d("# where this CLI lives")}
    ${d("$")} gg setup
    ${d("$")} gg start               ${d("# open web UI (not bare gg)")}
    ${d("$")} gg cnp                 ${d("# commit + push")}
    ${d("$")} gg cnp pr              ${d("# commit + push + create PR (asks base)")}
    ${d("$")} gg pr develop          ${d("# push + PR into develop")}
    ${d("$")} gg pr -y               ${d("# PR into default base (no base prompt)")}
    ${d("$")} gg mo google/gemini-2.0-flash-001
    ${d("$")} gg config reset        ${d("# redo the full onboard")}

  ${d("PR needs")} ${c.cyan("gh")} ${d("authenticated")} ${d("·")} ${d("AI:")} ${PROVIDER_LABEL[PROVIDER]} ${d(`(${model})`)}${apiKey ? c.green("  ✓ key set") : c.yellow("  ! no API key — run gitgen setup")}`;
}

async function main() {
  switch (cmd) {
    case "":
    case "help":
    case "-h":
    case "--help":
      log(helpText());
      return;

    case "version":
    case "--version":
    case "-v":
      log(header(`${CLI_NAME} · ${getVersion()}`));
      printInstallDetails();
      return;

    case "setup":
      await runSetup(readUserConfig());
      return;

    case "config":
      await cmdConfig();
      return;

    case "model":
      await cmdModel();
      return;

    case "update":
      await cmdUpdate();
      return;

    case "start": {
      await openApp();
      return;
    }

    case "commit": {
      // `cnp` = commit+push; optional trailing `pr [base]` opens a GitHub PR.
      // `commit push pr develop` / `cnp pr` / `commit pr` all work.
      const { push, wantPr, prBase } = parseCommitPrArgs(rawCmd, arg1, arg2, arg3);
      const label = wantPr ? "commit + push + PR" : push ? "commit + push" : "commit";
      banner(label);

      if (await hasChanges()) {
        const message = await resolveMessage(
          messageFlag,
          push || wantPr ? "feat: update" : "feat: save progress"
        );
        // When also opening a PR, skip runSteps' early "done" — single done after PR.
        if (wantPr) {
          try {
            await git(["add", "."]);
            await git(["commit", "-m", message]);
          } catch (e) {
            const stderr = (e as { stderr?: string })?.stderr;
            die(stderr?.trim() || (e instanceof Error ? e.message : String(e)));
          }
        } else {
          await runSteps(async () => {
            await git(["add", "."]);
            await git(["commit", "-m", message]);
            if (push) await git(["push"], { progress: true });
          });
        }
      } else if (!wantPr) {
        log(`  ${sym.ok} ${c.dim("nothing to commit — working tree clean")}`);
        return;
      } else {
        log(`  ${c.dim("nothing to commit — opening PR from current branch")}`);
      }

      if (wantPr) {
        // createPullRequest pushes (with -u if needed) then runs gh pr create
        try {
          await createPullRequest(prBase);
          log(`  ${sym.ok} ${c.green("done")}`);
        } catch (e) {
          const stderr = (e as { stderr?: string })?.stderr;
          die(stderr?.trim() || (e instanceof Error ? e.message : String(e)));
        }
      }
      return;
    }

    case "pr": {
      // gg pr [base]  — commit dirty work, push, AI title/body, gh pr create
      const baseArg = arg1 && !isPrToken(arg1) ? arg1 : undefined;
      banner(`pull request${baseArg ? ` → ${baseArg}` : ""}`);
      try {
        if (await hasChanges()) {
          const message = await resolveMessage(messageFlag, "feat: update");
          await git(["add", "."]);
          await git(["commit", "-m", message]);
        }
        await createPullRequest(baseArg);
        log(`  ${sym.ok} ${c.green("done")}`);
      } catch (e) {
        const stderr = (e as { stderr?: string })?.stderr;
        die(stderr?.trim() || (e instanceof Error ? e.message : String(e)));
      }
      return;
    }

    case "branch": {
      const name = arg1;
      if (!name) die('branch name required — e.g. gg b feature/login  (or gitgen branch feature/login)');
      banner(`create branch ${name}`);
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
      const source = arg1;
      if (!source) die('branch name required — e.g. gg m feature/login [target]');
      const target = arg2 || "main";
      banner(`merge ${source} → ${target}`);
      const message = await resolveMessage(messageFlag, `merge: integrate ${source} into ${target}`);
      await runSteps(async () => {
        if (await hasChanges()) {
          await git(["add", "."]);
          await git(["commit", "-m", message]);
        }
        await git(["checkout", target]);
        await git(["merge", source]);
        await git(["push"], { progress: true });
      });
      return;
    }

    case "save": {
      banner("save & return to main");
      const message = await resolveMessage(messageFlag, "wip: saving progress");
      await runSteps(async () => {
        if (await hasChanges()) {
          await git(["add", "."]);
          await git(["commit", "-m", message]);
        } else {
          log(`  ${c.dim("nothing to commit — switching only")}`);
        }
        await git(["checkout", "main"]);
      });
      return;
    }

    case "switch": {
      const target = arg1;
      if (!target) die('branch name required — e.g. gg sw main  (or gitgen switch main)');
      banner(`switch to ${target}`);
      await runSteps(async () => {
        await git(["checkout", target]);
      });
      return;
    }

    case "remote": {
      const url = arg1;
      if (!url) die('repository URL required — e.g. gg r https://github.com/me/repo.git');
      banner("add remote origin");
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
      banner(`restore ${c.red(what)}`);
      if (!yes) {
        const ok = await confirm(`Destructive: this discards ${what} and cannot be undone. Continue?`);
        if (!ok) {
          log(`  ${c.dim("restore aborted")}`);
          return;
        }
      }
      await runSteps(async () => {
        await git(["restore", target]);
      });
      return;
    }

    default:
      die(`unknown command "${rawCmd}". Run "gg h" or "gitgen help" for the list.`);
  }
}

main();
