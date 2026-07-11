/**
 * Environment health checks for `gitgen doctor`.
 * Framework-agnostic — safe to unit-test with injected command runners.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import {
  type CommitLanguage,
  type GitgenConfig,
  getConfigPath,
  loadConfig,
  looksLikeOpenRouterKey,
  maskApiKey,
  resolveRuntimeSettings,
} from "./config";

const pexec = promisify(execFile);

export type DoctorStatus = "ok" | "warn" | "fail";

export type DoctorCheck = {
  id: string;
  label: string;
  status: DoctorStatus;
  detail: string;
  tip?: string;
};

export type DoctorSummary = {
  checks: DoctorCheck[];
  ok: number;
  warn: number;
  fail: number;
  exitCode: number;
};

type EnvLike = Record<string, string | undefined>;

type RunCmdResult = { stdout: string; stderr: string; code: number };

export type DoctorDeps = {
  cwd: string;
  env?: EnvLike;
  nodeVersion?: string;
  platform?: NodeJS.Platform;
  /** Override command runner (tests). Default: execFile with timeout. */
  runCmd?: (cmd: string, args: string[], cwd: string) => Promise<RunCmdResult>;
  /** Override fetch (tests). Default: global fetch. */
  fetchFn?: typeof fetch;
  loadConfigFn?: (path: string) => GitgenConfig;
  configPath?: string;
};

const MIN_NODE_MAJOR = 18;

async function defaultRunCmd(cmd: string, args: string[], cwd: string): Promise<RunCmdResult> {
  try {
    const { stdout, stderr } = await pexec(cmd, args, {
      cwd,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
      timeout: 15_000,
    });
    return { stdout: String(stdout), stderr: String(stderr), code: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; code?: number; message?: string };
    return {
      stdout: String(err.stdout || ""),
      stderr: String(err.stderr || err.message || ""),
      code: typeof err.code === "number" ? err.code : 1,
    };
  }
}

/** Parse `v22.3.0` → 22. Returns 0 when unparseable. */
export function parseNodeMajor(version: string): number {
  const m = version.trim().match(/^v?(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

export function summarizeDoctorChecks(checks: DoctorCheck[]): DoctorSummary {
  const ok = checks.filter((c) => c.status === "ok").length;
  const warn = checks.filter((c) => c.status === "warn").length;
  const fail = checks.filter((c) => c.status === "fail").length;
  return { checks, ok, warn, fail, exitCode: fail > 0 ? 1 : 0 };
}

async function checkNode(deps: DoctorDeps): Promise<DoctorCheck> {
  const major = parseNodeMajor(deps.nodeVersion ?? process.version);
  if (major >= MIN_NODE_MAJOR) {
    return {
      id: "node",
      label: "Node.js",
      status: "ok",
      detail: `v${major} (>= ${MIN_NODE_MAJOR})`,
    };
  }
  return {
    id: "node",
    label: "Node.js",
    status: "fail",
    detail: major ? `v${major} — need >= ${MIN_NODE_MAJOR}` : "version unknown",
    tip: "Install Node 18+ from https://nodejs.org",
  };
}

async function checkGit(deps: DoctorDeps, run: DoctorDeps["runCmd"]): Promise<DoctorCheck> {
  const result = await run!("git", ["--version"], deps.cwd);
  if (result.code !== 0) {
    return {
      id: "git",
      label: "Git",
      status: "fail",
      detail: "not found on PATH",
      tip: "Install Git from https://git-scm.com",
    };
  }
  const line = (result.stdout || result.stderr).trim().split("\n")[0] || "git";
  return { id: "git", label: "Git", status: "ok", detail: line };
}

async function checkRepo(deps: DoctorDeps, run: DoctorDeps["runCmd"]): Promise<DoctorCheck> {
  const result = await run!("git", ["rev-parse", "--is-inside-work-tree"], deps.cwd);
  const inside = result.code === 0 && result.stdout.trim() === "true";
  if (inside) {
    return { id: "repo", label: "Git repo", status: "ok", detail: deps.cwd };
  }
  return {
    id: "repo",
    label: "Git repo",
    status: "fail",
    detail: "not inside a work tree",
    tip: "cd into a project folder or run git init",
  };
}

async function checkBranch(deps: DoctorDeps, run: DoctorDeps["runCmd"]): Promise<DoctorCheck | null> {
  const repo = await run!("git", ["rev-parse", "--is-inside-work-tree"], deps.cwd);
  if (repo.code !== 0 || repo.stdout.trim() !== "true") return null;

  const branch = await run!("git", ["branch", "--show-current"], deps.cwd);
  const name = branch.stdout.trim();
  if (name) {
    return { id: "branch", label: "Branch", status: "ok", detail: name };
  }
  return {
    id: "branch",
    label: "Branch",
    status: "warn",
    detail: "detached HEAD",
    tip: "checkout a branch before commit/push/PR workflows",
  };
}

async function checkUpstream(deps: DoctorDeps, run: DoctorDeps["runCmd"]): Promise<DoctorCheck | null> {
  const repo = await run!("git", ["rev-parse", "--is-inside-work-tree"], deps.cwd);
  if (repo.code !== 0 || repo.stdout.trim() !== "true") return null;

  const branch = await run!("git", ["branch", "--show-current"], deps.cwd);
  if (!branch.stdout.trim()) return null; // detached HEAD — checkBranch already warns

  const up = await run!("git", ["rev-parse", "--abbrev-ref", "@{upstream}"], deps.cwd);
  const name = up.stdout.trim();
  if (name) {
    return { id: "upstream", label: "Upstream", status: "ok", detail: name };
  }
  return {
    id: "upstream",
    label: "Upstream",
    status: "warn",
    detail: "none — push may need -u",
    tip: "gg cnp or gg b <name> sets upstream on first push",
  };
}

function checkApiKey(file: GitgenConfig, env: EnvLike): DoctorCheck {
  const { apiKey, model, language } = resolveRuntimeSettings(file, env);
  if (!apiKey) {
    return {
      id: "api-key",
      label: "OpenRouter key",
      status: "warn",
      detail: "not set — AI commits use defaults",
      tip: "run gg setup",
    };
  }
  const masked = maskApiKey(apiKey);
  if (!looksLikeOpenRouterKey(apiKey)) {
    return {
      id: "api-key",
      label: "OpenRouter key",
      status: "warn",
      detail: `${masked} — unexpected format`,
      tip: "OpenRouter keys usually start with sk-or-",
    };
  }
  return {
    id: "api-key",
    label: "OpenRouter key",
    status: "ok",
    detail: `${masked} · ${model} · ${language as CommitLanguage}`,
  };
}

function checkConfigPath(configPath: string): DoctorCheck {
  if (existsSync(configPath)) {
    return { id: "config", label: "Config", status: "ok", detail: configPath };
  }
  return {
    id: "config",
    label: "Config",
    status: "warn",
    detail: `${configPath} — not found, using defaults`,
    tip: "run gg setup",
  };
}

async function checkGh(run: DoctorDeps["runCmd"], cwd: string): Promise<DoctorCheck> {
  const ver = await run!("gh", ["--version"], cwd);
  if (ver.code !== 0) {
    return {
      id: "gh",
      label: "GitHub CLI",
      status: "warn",
      detail: "not found — PR commands need gh",
      tip: "https://cli.github.com",
    };
  }
  const line = ver.stdout.trim().split("\n")[0] || "gh";
  return { id: "gh", label: "GitHub CLI", status: "ok", detail: line };
}

async function checkGhAuth(
  run: DoctorDeps["runCmd"],
  cwd: string,
  ghAvailable: boolean
): Promise<DoctorCheck | null> {
  if (!ghAvailable) return null;

  const auth = await run!("gh", ["auth", "status"], cwd);
  if (auth.code === 0) {
    const host = auth.stderr.includes("github.com") || auth.stdout.includes("github.com")
      ? "github.com"
      : "authenticated";
    return { id: "gh-auth", label: "gh auth", status: "ok", detail: host };
  }
  return {
    id: "gh-auth",
    label: "gh auth",
    status: "warn",
    detail: "not logged in",
    tip: "run: gh auth login",
  };
}

async function checkOpenRouter(
  apiKey: string,
  fetchFn: typeof fetch
): Promise<DoctorCheck | null> {
  if (!apiKey || !looksLikeOpenRouterKey(apiKey)) return null;

  try {
    const res = await fetchFn("https://openrouter.ai/api/v1/models", {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(12_000),
    });
    if (res.ok) {
      return { id: "openrouter", label: "OpenRouter API", status: "ok", detail: "reachable" };
    }
    if (res.status === 401 || res.status === 403) {
      return {
        id: "openrouter",
        label: "OpenRouter API",
        status: "fail",
        detail: `HTTP ${res.status} — key rejected`,
        tip: "check the key at https://openrouter.ai/keys",
      };
    }
    return {
      id: "openrouter",
      label: "OpenRouter API",
      status: "warn",
      detail: `HTTP ${res.status}`,
    };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return {
      id: "openrouter",
      label: "OpenRouter API",
      status: "warn",
      detail: `unreachable (${reason})`,
      tip: "check network / firewall",
    };
  }
}

/** Run all doctor checks and return a summary (exitCode 1 when any check failed). */
export async function runDoctorChecks(deps: DoctorDeps): Promise<DoctorSummary> {
  const env = deps.env ?? process.env;
  const run = deps.runCmd ?? defaultRunCmd;
  const fetchFn = deps.fetchFn ?? fetch;
  const configPath = deps.configPath ?? getConfigPath(env, deps.platform);
  const loadConfigFn = deps.loadConfigFn ?? loadConfig;
  const file = loadConfigFn(configPath);
  const { apiKey } = resolveRuntimeSettings(file, env);

  const checks: DoctorCheck[] = [
    await checkNode(deps),
    await checkGit(deps, run),
    await checkRepo(deps, run),
  ];

  const branch = await checkBranch(deps, run);
  if (branch) checks.push(branch);

  const upstream = await checkUpstream(deps, run);
  if (upstream) checks.push(upstream);

  checks.push(checkApiKey(file, env));
  checks.push(checkConfigPath(configPath));

  const gh = await checkGh(run, deps.cwd);
  checks.push(gh);

  const ghAuth = await checkGhAuth(run, deps.cwd, gh.status === "ok");
  if (ghAuth) checks.push(ghAuth);

  const or = await checkOpenRouter(apiKey, fetchFn);
  if (or) checks.push(or);

  return summarizeDoctorChecks(checks);
}