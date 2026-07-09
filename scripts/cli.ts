/**
 * gitgen / gg CLI — terminal equivalents of every workflow card in the web app.
 * Runs git in the current folder (no server needed) and reuses lib/commit-message.ts.
 *
 * Config: user-level OpenRouter settings (see lib/config.ts). Env overrides allowed.
 * Run:  node dist/cli.js <cmd>  |  gitgen <cmd>  |  gg <cmd>
 *
 * Long form              Short        What it does
 * ─────────────────────  ───────────  ──────────────────────────────────────────
 *   start                start        open the web app with current folder
 *   commit [push]        c [p]        add . -> (AI) commit [-> push]
 *   branch <name>        b <name>     checkout -b -> add -> commit -> push -u
 *   merge  <src> [dst]   m <src> [d]  add -> commit -> checkout dst -> merge -> push
 *   save                 s            add -> commit -> checkout main
 *   switch <branch>      sw <branch>  checkout <branch>
 *   remote <url>         r <url>      init -> remote add origin -> first push
 *   restore [file]       rs [file]    git restore . (or one file) — destructive
 *   setup                setup        OpenRouter onboard (key + model + language)
 *   config […]           config       show or set config
 *   update               u            check npm for a newer version / install
 *   version              v            print CLI / package version
 *   help                 h            show this list (also the default with no args)
 *
 * Flags: -m / --message "msg" · -y / --yes (skip restore confirm)
 * Also: --version / -v / -V (same as version)
 */
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createInterface } from "node:readline/promises";
import { dirname, join } from "node:path";
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
  maskApiKey,
  resolveRuntimeSettings,
  saveConfig,
} from "../lib/config";
import {
  evaluateUpdate,
  npmGlobalInstallCommand,
  parseNpmLatestVersion,
} from "../lib/update-check";
import { APP_NAME, CLI_NAME, getPackageName, getVersion } from "../lib/version";

const pexec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
// Source: scripts/ → repo root; bundled: dist/ → package root
const packageRoot = join(here, "..");
const cwd = process.cwd();

const PROVIDER = "openrouter" as const;

/* ── helpers ── */
function log(msg: string) {
  console.log(msg);
}
function die(msg: string): never {
  console.error(`  error  : ${msg}`);
  process.exit(1);
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
  // Full-width clear then write; truncate so the line never wraps.
  const paint = (content: string, newline = false) => {
    const cols = termCols();
    const max = cols - 1;
    const line = content.length > max ? `${content.slice(0, Math.max(1, max - 1))}…` : content;
    process.stdout.write(`\r${" ".repeat(max)}\r${line}${newline ? "\n" : ""}`);
  };
  const draw = () => {
    paint(
      `  ${SPINNER[(frame = (frame + 1) % SPINNER.length)]} ${label}${renderDetail(detail)}  ${secs(start)}`
    );
  };
  let timer: ReturnType<typeof setInterval> | undefined;
  if (animate) {
    draw();
    timer = setInterval(draw, 100);
  } else {
    log(`  · ${label}`);
  }
  const finish = (mark: string) => {
    if (timer) clearInterval(timer);
    if (animate) paint(`  ${mark} ${label}  ${secs(start)}`, true);
    else log(`  ${mark} ${label}  ${secs(start)}`);
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
    .map((l) => `    ${l.trim()}`)
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

async function promptLine(question: string, defaultValue?: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const hint = defaultValue ? ` [${defaultValue}]` : "";
  const answer = (await rl.question(`  ${question}${hint}\n  > `)).trim();
  rl.close();
  return answer || defaultValue || "";
}

/** Interactive OpenRouter-only onboard. */
async function runSetup(existing?: GitgenConfig): Promise<GitgenConfig> {
  log("");
  log(`  ${CLI_NAME} setup — OpenRouter`);
  log("  ─────────────────────────────");
  log("  Get a key at https://openrouter.ai/keys");
  log("");

  const prev = existing || readUserConfig();
  const key = await promptLine(
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
  log(`  ✓ Saved to ${path}`);
  log(`  model : ${model}`);
  log(`  lang  : ${language}`);
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

  log(`  No OpenRouter API key found (${configPath}).`);
  log("  Starting first-time setup…");
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
      log(`  message: ${m}`);
      return m;
    } catch (e) {
      const reason =
        e instanceof CommitMessageError
          ? e.message
          : e instanceof Error
            ? e.message
            : String(e);
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

const SHORT_CMDS: Record<string, string> = {
  c: "commit",
  b: "branch",
  m: "merge",
  s: "save",
  sw: "switch",
  r: "remote",
  rs: "restore",
  v: "version",
  h: "help",
  u: "update",
};

const rawCmd = (positional[0] || "").toLowerCase();
const cmd = SHORT_CMDS[rawCmd] || rawCmd;
const arg1 = positional[1];
const arg2 = positional[2];
const arg3 = positional[3];

function isPushToken(t: string | undefined): boolean {
  const v = (t || "").toLowerCase();
  return v === "push" || v === "p";
}

/** Open the web app for the current folder (local-dev; needs a checkout of this repo). */
async function openApp(): Promise<void> {
  const port = process.env.GCG_PORT || "2001";
  log(`Git Command Generator — start (folder: ${cwd})`);
  log("  note   : web UI is local-dev (npm run dev in a full checkout)");
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
              join(packageRoot, "scripts", "open-here.ps1"),
              "-Port",
              port,
            ],
            { stdio: "inherit", cwd, windowsHide: true }
          )
        : spawn(process.execPath, [join(packageRoot, "scripts", "open-here.mjs")], {
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
}

async function cmdConfig(): Promise<void> {
  const sub = (arg1 || "show").toLowerCase();
  const path = getConfigPath();
  const file = loadConfig(path);
  const runtime = resolveRuntimeSettings(file, process.env);

  if (sub === "show" || sub === "") {
    log(`${CLI_NAME} config`);
    log(`  path   : ${path}`);
    log(
      `  key    : ${runtime.apiKey ? maskApiKey(runtime.apiKey) : "(not set)"}`
    );
    log(`  model  : ${runtime.model}`);
    log(`  lang   : ${runtime.language}`);
    log(`  source : ${process.env.OPENROUTER_API_KEY ? "env (+ file)" : "config file"}`);
    return;
  }

  if (sub === "set") {
    const field = (arg2 || "").toLowerCase();
    const value = arg3;
    if (!field || value === undefined) {
      die('usage: gitgen config set <model|key|language> <value>');
    }
    const next: GitgenConfig = { ...file };
    if (field === "model") next.model = value;
    else if (field === "key" || field === "apikey" || field === "api-key") {
      next.openRouterApiKey = value;
    } else if (field === "language" || field === "lang") {
      next.language = value.toLowerCase() === "pt" ? "pt" : "en";
    } else {
      die(`unknown field "${field}" — use model, key, or language`);
    }
    saveConfig(next, path);
    log(`  ✓ Updated ${field} in ${path}`);
    return;
  }

  if (sub === "path") {
    log(path);
    return;
  }

  die(`unknown config subcommand "${sub}" — use show | set | path`);
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
  log(`${CLI_NAME} update`);
  log(`  package: ${packageName}`);
  log(`  current: ${current}`);

  let latest: string;
  try {
    latest = await withProgress("check npm registry", () => fetchLatestFromNpm(packageName));
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    log(`  status : could not check registry (${reason})`);
    log(`  tip    : ${npmGlobalInstallCommand(packageName)}`);
    process.exitCode = 1;
    return;
  }

  const result = evaluateUpdate(current, latest);
  if (result.status === "up-to-date") {
    log(`  latest : ${latest}`);
    log("  status : already up to date");
    return;
  }
  if (result.status === "unknown") {
    log(`  latest : ${latest}`);
    log(`  status : ${result.reason}`);
    log(`  tip    : ${npmGlobalInstallCommand(packageName, latest)}`);
    return;
  }

  log(`  latest : ${latest}`);
  log("  status : update available");
  const installCmd = npmGlobalInstallCommand(packageName, latest);
  log(`  running: ${installCmd}`);

  await new Promise<void>((resolve) => {
    const child = spawn("npm", ["install", "-g", `${packageName}@${latest}`], {
      stdio: "inherit",
      shell: true,
      windowsHide: true,
    });
    child.on("error", (err) => {
      log(`  error  : ${err.message}`);
      log(`  tip    : run manually: ${installCmd}`);
      process.exitCode = 1;
      resolve();
    });
    child.on("close", (code) => {
      if (code === 0) {
        log(`  done   : installed ${packageName}@${latest}`);
        log(`  verify : ${CLI_NAME} version`);
      } else {
        log(`  error  : npm exited with code ${code ?? "?"}`);
        log(`  tip    : ${installCmd}`);
        process.exitCode = code ?? 1;
      }
      resolve();
    });
  });
}

function helpText(): string {
  const { apiKey, model } = currentSettings();
  return `gitgen / gg — terminal git workflows (folder: ${cwd})
  ${CLI_NAME} ${getVersion()}  (${APP_NAME})

  Long                    Short              Action
  ──────────────────────  ─────────────────  ────────────────────────────────────
  start                   start              open the web app with this folder
  commit [push] [-m msg]  c [p] [-m msg]     add . -> commit [-> push]  (AI if no -m)
  branch <name> [-m msg]  b <name> [-m msg]  new branch -> add -> commit -> push -u
  merge  <src> [dst] [-m] m <src> [dst] [-m] commit -> checkout dst|main -> merge -> push
  save   [-m msg]         s [-m msg]         commit current work, then checkout main
  switch <branch>         sw <branch>        checkout <branch>
  remote <url> [-m msg]   r <url> [-m msg]   git init -> remote add origin -> first push
  restore [file] [-y]     rs [file] [-y]     discard changes (all, or one file)
  setup                   setup              OpenRouter onboard (API key + model)
  config [show|set|path]  config             show or set user config
  update                  u                  check npm / install latest
  version                 v / -v / --version print installed version (from package.json)
  help                    h                  show this list (default if no command)

  Examples:
    npm install -g ${getPackageName()}
    gg setup
    gg c p
    gg config set model google/gemini-2.0-flash-001
    gg update
    gg v

AI: ${PROVIDER_LABEL[PROVIDER]} (${model})${apiKey ? "" : " — no API key (run gitgen setup)"}`;
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
      log(`${CLI_NAME} ${getVersion()}`);
      log(`${APP_NAME} (package.json)`);
      return;

    case "setup":
      await runSetup(readUserConfig());
      return;

    case "config":
      await cmdConfig();
      return;

    case "update":
      await cmdUpdate();
      return;

    case "start": {
      await openApp();
      return;
    }

    case "commit": {
      const push = isPushToken(arg1);
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
      if (!name) die('branch name required — e.g. gg b feature/login  (or gitgen branch feature/login)');
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
      const source = arg1;
      if (!source) die('branch name required — e.g. gg m feature/login [target]');
      const target = arg2 || "main";
      log(`Git Command Generator — merge ${source} into ${target}`);
      log(`  folder : ${cwd}`);
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
      if (!target) die('branch name required — e.g. gg sw main  (or gitgen switch main)');
      log(`Git Command Generator — switch to ${target}`);
      log(`  folder : ${cwd}`);
      await runSteps(async () => {
        await git(["checkout", target]);
      });
      return;
    }

    case "remote": {
      const url = arg1;
      if (!url) die('repository URL required — e.g. gg r https://github.com/me/repo.git');
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
      die(`unknown command "${rawCmd}". Run "gg h" or "gitgen help" for the list.`);
  }
}

main();
