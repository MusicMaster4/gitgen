/**
 * AI pull-request title + body generation — shared by the CLI `pr` flow.
 * Two separate model calls (title, then body) so we never depend on JSON.
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
const MAX_TITLE_TOKENS = 64;
const MAX_BODY_TOKENS = 512;
const MAX_TITLE_CHARS = 72;

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

type PrPart = "title" | "body";

const TITLE_PROMPTS: Record<string, string> = {
  en: `GitHub pull request title generator. Reply with ONE line only.

Rules:
- Conventional Commits style preferred: "feat: …" / "fix: …" / "chore: …"
- English, imperative, concise
- Aim for ~${MAX_TITLE_CHARS} characters. Prefer a complete title over cutting mid-word.
- ONLY the title. No quotes, no period, no markdown, no extra text.

Examples:
feat: add automatic PR generation
fix: correct branch field validation
chore: update release documentation`,
  pt: `Gerador de titulo de pull request no GitHub. Responda com UMA linha apenas.

Regras:
- Estilo Conventional Commits quando fizer sentido: "feat: …" / "fix: …" / "chore: …"
- Portugues, imperativo, conciso
- Almeje ~${MAX_TITLE_CHARS} caracteres. Prefira um titulo completo a cortar no meio da palavra.
- APENAS o titulo. Sem aspas, sem ponto final, sem markdown, sem texto extra.

Exemplos:
feat: adiciona geracao automatica de PR
fix: corrige validacao do campo de branch
chore: atualiza documentacao de release`,
};

const BODY_PROMPTS: Record<string, string> = {
  en: `GitHub pull request description writer. Reply with markdown only.

Rules:
- Start with a ## Summary section (2–5 bullets of what changed and why)
- Optionally add ## Test plan with a short checklist
- Be concrete; use the commits and files provided
- English
- No title line, no JSON, no code fences around the whole reply
- No placeholder fluff like "This PR does X"`,
  pt: `Escritor de descricao de pull request no GitHub. Responda apenas em markdown.

Regras:
- Comece com ## Resumo (2–5 bullets do que mudou e por que)
- Opcionalmente adicione ## Plano de teste com checklist curto
- Seja concreto; use os commits e arquivos fornecidos
- Portugues
- Sem linha de titulo, sem JSON, sem fences de codigo em volta da resposta inteira
- Sem enrolacao generica`,
};

function systemPrompt(part: PrPart, language: string): string {
  const map = part === "title" ? TITLE_PROMPTS : BODY_PROMPTS;
  return map[language] || map.en;
}

function openRouterRequest(
  apiKey: string,
  model: string,
  system: string,
  context: string,
  maxTokens: number
) {
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
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: context },
      ],
    }),
  });
}

function openAiRequest(
  apiKey: string,
  model: string,
  system: string,
  context: string,
  maxTokens: number
) {
  return fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      instructions: system,
      input: context,
      max_output_tokens: maxTokens,
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

/** Sanitize a one-line PR title from free-form model output. */
export function cleanTitle(raw: string): string {
  let text = (raw || "").trim();
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  text = text.replace(/<\/?think>/gi, "").trim();

  // Prefer the first non-empty line
  const line =
    text
      .split("\n")
      .map((l) => l.trim())
      .find(Boolean) || "";

  return line
    .replace(/^\s*(pr title|title|titulo)\s*[:\-]\s*/i, "")
    .replace(/^[\s"'`*#\-]+/, "")
    .replace(/[\s"'`.]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

/** Sanitize markdown PR body from free-form model output. */
export function cleanBody(raw: string): string {
  let text = (raw || "").trim();
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  text = text.replace(/<\/?think>/gi, "").trim();

  // Drop a single outer markdown fence if the model wrapped the whole reply
  if (/^```(?:markdown|md)?\s*\n/i.test(text) && text.endsWith("```")) {
    text = text
      .replace(/^```(?:markdown|md)?\s*\n/i, "")
      .replace(/\n```\s*$/i, "")
      .trim();
  }

  text = text.replace(/^\s*(pr body|body|descricao|description)\s*[:\-]\s*/i, "").trim();
  return text;
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

async function completePart(
  opts: {
    provider: Provider;
    apiKey: string;
    model: string;
    language: string;
    context: string;
    part: PrPart;
  }
): Promise<string> {
  const { provider, apiKey, model, language, context, part } = opts;
  const system = systemPrompt(part, language);
  const maxTokens = part === "title" ? MAX_TITLE_TOKENS : MAX_BODY_TOKENS;

  const res =
    provider === "openai"
      ? await openAiRequest(apiKey, model, system, context, maxTokens)
      : await openRouterRequest(apiKey, model, system, context, maxTokens);

  if (!res.ok) {
    throw new PrMessageError(await readProviderError(res, provider));
  }

  const data = await res.json();
  return extractResponseText(data);
}

/**
 * Generate a PR title + markdown body from commits/diff of head vs base.
 * Uses two independent model calls (title, body) — no JSON required.
 * Throws PrMessageError on failure.
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
  const common = { provider, apiKey, model, language, context };

  // Parallel: title and body don't depend on each other
  const [rawTitle, rawBody] = await Promise.all([
    completePart({ ...common, part: "title" }),
    completePart({ ...common, part: "body" }),
  ]);

  const title = cleanTitle(rawTitle);
  const body = cleanBody(rawBody);

  if (!title) {
    throw new PrMessageError("Model did not return a PR title");
  }
  if (!body) {
    throw new PrMessageError("Model did not return a PR body");
  }

  return { title, body };
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
  const subject = (await git(path, ["log", "-1", "--pretty=%s"])).trim();
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
