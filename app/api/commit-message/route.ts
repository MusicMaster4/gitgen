import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pexec = promisify(execFile);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Provider = "openrouter" | "openai";

const PROVIDER_LABEL: Record<Provider, string> = {
  openrouter: "OpenRouter",
  openai: "OpenAI",
};

const DEFAULT_MODELS: Record<Provider, string> = {
  openrouter: "google/gemini-2.0-flash-001",
  openai: "gpt-5.4-mini",
};

/** Caps keep latency low — short Conventional Commits don't need a big window. */
const MAX_DIFF_CHARS = 6000;
const MAX_COMPLETION_TOKENS = 64;

const PROMPTS: Record<string, string> = {
  en: `Git commit message generator. Reply with ONE line only.

Rules:
- Conventional Commits: "<type>: <description>" (feat|fix|refactor|style|docs|chore|test|perf|build|ci)
- English, imperative, lowercase description
- MAX 60 characters total. Short and specific.
- ONLY the message. No quotes, no period, no extra text.

Examples:
feat: add automatic commit generation
fix: correct branch field validation
chore: bump project dependencies`,
  pt: `Gerador de mensagem de commit git. Responda com UMA linha apenas.

Regras:
- Conventional Commits: "<tipo>: <descricao>" (feat|fix|refactor|style|docs|chore|test|perf|build|ci)
- Portugues, imperativo, minusculas na descricao
- MAX 60 caracteres no total. Curta e especifica.
- APENAS a mensagem. Sem aspas, sem ponto final, sem texto extra.

Exemplos:
feat: adiciona geracao automatica de commit
fix: corrige validacao do campo de branch
chore: atualiza dependencias do projeto`,
};

interface CommitRequestBody {
  path?: string;
  provider?: string;
  apiKey?: string;
  model?: string;
  openRouterApiKey?: string;
  openRouterModel?: string;
  openAiApiKey?: string;
  openAiModel?: string;
  language?: string;
}

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await pexec("git", args, {
      cwd,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
      timeout: 15_000,
    });
    return stdout;
  } catch {
    return "";
  }
}

const CC_RE = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]+\))?!?:\s?.+/i;

function stripEdges(s: string): string {
  return s
    .replace(/^\s*(commit message|mensagem( de commit)?|commit)\s*[:\-]\s*/i, "")
    .replace(/^["'`*\-\s]+/, "")
    .replace(/["'`*\s.]+$/, "")
    .trim();
}

function cleanMessage(raw: string): string {
  let text = (raw || "").trim();
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  text = text.replace(/<\/?think>/gi, "").trim();

  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return "";

  for (let i = lines.length - 1; i >= 0; i--) {
    const candidate = stripEdges(lines[i]);
    if (CC_RE.test(candidate)) return candidate.slice(0, 60);
  }

  return stripEdges(lines[lines.length - 1]).slice(0, 60);
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

/** Compact context: status + name-status + truncated patch (faster than raw 14k diffs). */
function buildContext(status: string, nameStatus: string, diff: string, untracked: string): string {
  const parts: string[] = [];

  const st = status.trim();
  if (st) parts.push(`STATUS:\n${st}`);

  const ns = nameStatus.trim();
  if (ns) parts.push(`FILES:\n${ns}`);

  const ut = untracked.trim();
  if (ut) parts.push(`UNTRACKED:\n${ut}`);

  let patch = diff.trim();
  if (patch) {
    if (patch.length > MAX_DIFF_CHARS) {
      patch = `${patch.slice(0, MAX_DIFF_CHARS)}\n…(truncated)`;
    }
    parts.push(`DIFF:\n${patch}`);
  }

  return parts.join("\n\n");
}

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
      temperature: 0.1,
      max_tokens: MAX_COMPLETION_TOKENS,
      messages: [
        { role: "system", content: PROMPTS[language] },
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
      instructions: PROMPTS[language],
      input: context,
      max_output_tokens: MAX_COMPLETION_TOKENS,
      temperature: 0.1,
    }),
  });
}

async function readProviderError(res: Response, provider: Provider): Promise<string> {
  const text = await res.text().catch(() => "");
  let detail = `${PROVIDER_LABEL[provider]} responded with ${res.status}`;
  try {
    const j = JSON.parse(text) as { error?: { message?: string } };
    if (j?.error?.message) detail = j.error.message;
  } catch {
    /* keep default detail */
  }
  return detail;
}

export async function POST(req: NextRequest) {
  let body: CommitRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const path = (body.path || "").trim();
  const provider: Provider = body.provider === "openai" ? "openai" : "openrouter";
  const apiKey =
    provider === "openai"
      ? (body.openAiApiKey || "").trim() || (process.env.OPENAI_API_KEY || "").trim()
      : (body.openRouterApiKey || body.apiKey || "").trim() || (process.env.OPENROUTER_API_KEY || "").trim();
  const model =
    provider === "openai"
      ? (body.openAiModel || body.model || "").trim() || (process.env.OPENAI_MODEL || "").trim() || DEFAULT_MODELS.openai
      : (body.openRouterModel || body.model || "").trim() ||
        (process.env.OPENROUTER_MODEL || "").trim() ||
        DEFAULT_MODELS.openrouter;
  const language = body.language === "pt" ? "pt" : "en";

  if (!path) {
    return NextResponse.json({ error: "Set the project folder path in settings" }, { status: 400 });
  }
  if (!apiKey) {
    return NextResponse.json(
      { error: `Set the ${PROVIDER_LABEL[provider]} API key in settings` },
      { status: 400 }
    );
  }

  const isRepo = (await git(path, ["rev-parse", "--is-inside-work-tree"])).trim();
  if (isRepo !== "true") {
    return NextResponse.json(
      { error: "Folder is not a git repository (or path does not exist)" },
      { status: 422 }
    );
  }

  // Parallel git reads — biggest local latency win on Windows (multiple process spawns).
  const [status, nameStatus, diffHead, untracked] = await Promise.all([
    git(path, ["status", "--porcelain", "-u"]),
    git(path, ["diff", "HEAD", "--name-status"]),
    git(path, ["diff", "HEAD"]),
    git(path, ["ls-files", "--others", "--exclude-standard"]),
  ]);

  let diff = diffHead;
  if (!diff.trim() && !untracked.trim()) {
    // Unstaged-only edge case (rare when HEAD missing); one extra call only if needed.
    diff = await git(path, ["diff"]);
  }

  const context = buildContext(status, nameStatus, diff, untracked);

  if (!context.trim()) {
    return NextResponse.json({ error: "No changes detected in the repository" }, { status: 422 });
  }

  try {
    const res =
      provider === "openai"
        ? await openAiRequest(apiKey, model, language, context)
        : await openRouterRequest(apiKey, model, language, context);

    if (!res.ok) {
      const detail = await readProviderError(res, provider);
      return NextResponse.json({ error: detail }, { status: 502 });
    }

    const data = await res.json();
    const message = cleanMessage(extractResponseText(data));

    if (!message) {
      return NextResponse.json({ error: "Model did not return a message" }, { status: 502 });
    }

    return NextResponse.json({ message });
  } catch (e) {
    const msg = e instanceof Error ? e.message : `Failed to reach ${PROVIDER_LABEL[provider]}`;
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
