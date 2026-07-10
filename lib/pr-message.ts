/**
 * AI pull-request title + body generation — shared by the CLI `pr` flow.
 * Framework-agnostic (node builtins + fetch only), mirrors commit-message.ts.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  CommitMessageError,
  PROVIDER_LABEL,
  type Provider,
  git,
} from "./commit-message";

const pexec = promisify(execFile);

const MAX_DIFF_CHARS = 8000;
const MAX_LOG_CHARS = 4000;
const MAX_COMPLETION_TOKENS = 512;

export class PrMessageError extends Error {}

export interface PrContent {
  title: string;
  body: string;
}

export interface GeneratePrContentOptions {
  path: string;
  /** Base branch name (e.g. main) — compared as origin/base when available. */
  base: string;
  /** Head branch name (current feature branch). */
  head: string;
  provider: Provider;
  apiKey: string;
  model: string;
  language: "en" | "pt";
}

const PROMPTS: Record<string, string> = {
  en: `You write GitHub pull request titles and descriptions from a branch diff.

Reply with ONLY valid JSON (no markdown fences, no extra text):
{"title":"...","body":"..."}

Rules for title:
- Short, imperative, Conventional Commits style preferred: "feat: …" / "fix: …"
- Max ~72 characters, no trailing period
- English

Rules for body (markdown):
- Start with a ## Summary section (2–5 bullets of what changed and why)
- Optionally ## Test plan with a short checklist
- Be concrete; use the commits and files provided
- English
- No placeholder fluff like "This PR does X"`,
  pt: `Voce escreve titulos e descricoes de pull request no GitHub a partir do diff do branch.

Responda APENAS com JSON valido (sem fences markdown, sem texto extra):
{"title":"...","body":"..."}

Regras do titulo:
- Curto, imperativo, estilo Conventional Commits quando fizer sentido: "feat: …" / "fix: …"
- Max ~72 caracteres, sem ponto final
- Portugues

Regras do body (markdown):
- Comece com ## Resumo (2–5 bullets do que mudou e por que)
- Opcionalmente ## Plano de teste com checklist curto
- Seja concreto; use os commits e arquivos fornecidos
- Portugues
- Sem enrolacao generica`,
};

function openRouterRequest(apiKey: string, model: string, language: string, context: string) {
  return fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "X-Title": "Git Command Generator",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: MAX_COMPLETION_TOKENS,
      messages: [
        { role: "system", content: PROMPTS[language] || PROMPTS.en },
        { role: "user", content: context },
      ],
    }),
  });
}

function openAiRequest(apiKey: string, model: string, language: string, context: string) {
  return fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      instructions: PROMPTS[language] || PROMPTS.en,
      input: context,
      max_output_tokens: MAX_COMPLETION_TOKENS,
      temperature: 0.2,
    }),
  });
}

function extractResponseText(data: unknown): string {
  const response = data as {
    output_text?: unknown;
    output?: Array<{ content?: Array<{ text?: unknown }> }>;
    choices?: Array<{ message?: { content?: unknown } }>;
  };

  if (typeof response.output_text === "string") return response.output_text;

  const parts: string[] = [];
  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (typeof content.text === "string") parts.push(content.text);
    }
  }
  if (parts.length > 0) return parts.join("\n");

  const chatContent = response.choices?.[0]?.message?.content;
  return typeof chatContent === "string" ? chatContent : "";
}

async function readProviderError(res: Response, provider: Provider): Promise<string> {
  const text = await res.text().catch(() => "");
  let detail = `${PROVIDER_LABEL[provider]} responded with ${res.status}`;
  try {
    const j = JSON.parse(text) as { error?: { message?: string } };
    if (j?.error?.message) detail = j.error.message;
  } catch {
    /* keep default */
  }
  return detail;
}

/** Strip ```json fences and extract the first JSON object from model output. */
export function extractJsonObject(raw: string): string {
  let text = (raw || "").trim();
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return text.slice(start, end + 1);
  }
  return text;
}

/** Parse and sanitize model JSON into title + body. */
export function parsePrContent(raw: string): PrContent {
  const jsonText = extractJsonObject(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    // Fallback: TITLE:/BODY: plain text layout
    const titleMatch = raw.match(/^\s*TITLE:\s*(.+)$/im);
    const bodyMatch = raw.match(/BODY:\s*([\s\S]+)/i);
    if (titleMatch) {
      return {
        title: cleanTitle(titleMatch[1]),
        body: (bodyMatch?.[1] || "").trim() || cleanTitle(titleMatch[1]),
      };
    }
    throw new PrMessageError("Model did not return valid JSON for the PR");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PrMessageError("Model returned unexpected PR JSON shape");
  }
  const obj = parsed as Record<string, unknown>;
  const title = typeof obj.title === "string" ? cleanTitle(obj.title) : "";
  const body = typeof obj.body === "string" ? obj.body.trim() : "";
  if (!title) throw new PrMessageError("Model did not return a PR title");
  return { title, body: body || title };
}

export function cleanTitle(raw: string): string {
  return (raw || "")
    .replace(/^[\s"'`]+/, "")
    .replace(/[\s"'`.]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

/**
 * Resolve which ref to diff against for `base`.
 * Prefers origin/base when it exists, else local base, else the bare name.
 */
export async function resolveBaseRef(path: string, base: string): Promise<string> {
  const candidates = [`origin/${base}`, base];
  for (const ref of candidates) {
    const ok = (await git(path, ["rev-parse", "--verify", "--quiet", ref])).trim();
    if (ok) return ref;
  }
  return base;
}

/** Best-effort default base branch: origin/HEAD → main → master → "main". */
export async function detectDefaultBase(path: string): Promise<string> {
  const sym = (await git(path, ["symbolic-ref", "refs/remotes/origin/HEAD"])).trim();
  // refs/remotes/origin/main → main
  const m = sym.match(/refs\/remotes\/origin\/(.+)$/);
  if (m?.[1]) return m[1];

  for (const name of ["main", "master", "develop"]) {
    const ok = (await git(path, ["rev-parse", "--verify", "--quiet", `origin/${name}`])).trim();
    if (ok) return name;
    const local = (await git(path, ["rev-parse", "--verify", "--quiet", name])).trim();
    if (local) return name;
  }
  return "main";
}

function buildPrContext(
  head: string,
  base: string,
  baseRef: string,
  log: string,
  stat: string,
  diff: string
): string {
  const parts = [
    `HEAD branch: ${head}`,
    `BASE branch: ${base} (ref: ${baseRef})`,
  ];
  const lg = log.trim();
  if (lg) {
    parts.push(
      `COMMITS (${baseRef}...HEAD):\n${lg.length > MAX_LOG_CHARS ? `${lg.slice(0, MAX_LOG_CHARS)}\n…(truncated)` : lg}`
    );
  }
  const st = stat.trim();
  if (st) parts.push(`FILE STAT:\n${st}`);
  let patch = diff.trim();
  if (patch) {
    if (patch.length > MAX_DIFF_CHARS) {
      patch = `${patch.slice(0, MAX_DIFF_CHARS)}\n…(truncated)`;
    }
    parts.push(`DIFF:\n${patch}`);
  }
  return parts.join("\n\n");
}

/**
 * Generate a PR title + markdown body from commits/diff of head vs base.
 * Throws PrMessageError (or CommitMessageError-like) on failure.
 */
export async function generatePrContent(opts: GeneratePrContentOptions): Promise<PrContent> {
  const { path, base, head, provider, apiKey, model, language } = opts;

  const isRepo = (await git(path, ["rev-parse", "--is-inside-work-tree"])).trim();
  if (isRepo !== "true") {
    throw new PrMessageError("Folder is not a git repository (or path does not exist)");
  }

  const baseRef = await resolveBaseRef(path, base);
  const range = `${baseRef}...HEAD`;

  const [log, stat, diff] = await Promise.all([
    git(path, ["log", range, "--oneline", "--no-decorate"]),
    git(path, ["diff", range, "--stat"]),
    git(path, ["diff", range]),
  ]);

  if (!log.trim() && !diff.trim()) {
    throw new PrMessageError(
      `No commits or diff between ${baseRef} and HEAD — push commits first or pick another base`
    );
  }

  const context = buildPrContext(head, base, baseRef, log, stat, diff);

  const res =
    provider === "openai"
      ? await openAiRequest(apiKey, model, language, context)
      : await openRouterRequest(apiKey, model, language, context);

  if (!res.ok) {
    throw new PrMessageError(await readProviderError(res, provider));
  }

  const data = await res.json();
  return parsePrContent(extractResponseText(data));
}

/** Fallback when AI is unavailable: title from latest commit, body from log. */
export async function fallbackPrContent(
  path: string,
  base: string,
  head: string
): Promise<PrContent> {
  const baseRef = await resolveBaseRef(path, base);
  const range = `${baseRef}...HEAD`;
  const log = (await git(path, ["log", range, "--oneline", "--no-decorate"])).trim();
  const subject = (
    await git(path, ["log", "-1", "--pretty=%s"])
  ).trim();
  const title = cleanTitle(subject) || `Merge ${head} into ${base}`;
  const bullets = log
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 20)
    .map((l) => `- ${l.replace(/^[a-f0-9]+\s+/i, "")}`)
    .join("\n");
  const body = bullets
    ? `## Summary\n\n${bullets}\n`
    : `## Summary\n\n- Merge \`${head}\` into \`${base}\`\n`;
  return { title, body };
}

/**
 * Run a command and return stdout; throws with stderr on non-zero exit.
 * Used for `gh` — not for git (git helpers swallow errors).
 */
export async function runCapture(
  cmd: string,
  args: string[],
  cwd: string
): Promise<string> {
  try {
    const { stdout } = await pexec(cmd, args, {
      cwd,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
      timeout: 120_000,
    });
    return stdout;
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    const msg = (err.stderr || err.message || String(e)).trim();
    throw new Error(msg || `${cmd} failed`);
  }
}

/** True if `gh` is on PATH (does not require auth). */
export async function isGhAvailable(): Promise<boolean> {
  try {
    await pexec("gh", ["--version"], {
      windowsHide: true,
      timeout: 10_000,
    });
    return true;
  } catch {
    return false;
  }
}

// Re-export for callers that already import CommitMessageError patterns
export { CommitMessageError };
