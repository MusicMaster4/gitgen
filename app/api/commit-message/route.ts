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

const PROMPTS: Record<string, string> = {
  en: `You are a git commit message generator. You receive the diff of the changes and reply with ONE single commit message.

Strict rules:
- Conventional Commits format: "<type>: <description>" (types: feat, fix, refactor, style, docs, chore, test, perf, build, ci).
- Write in English, imperative mood, lowercase description.
- Max 60 characters total. Short and specific about what changed.
- Reply with ONLY the message. No quotes, no backticks, no explanation, no trailing period, no extra line break.

Valid examples:
feat: add automatic commit generation
fix: correct branch field validation
refactor: extract copy logic into a hook`,
  pt: `Voce e um gerador de mensagens de commit git. Recebe o diff das mudancas e responde com UMA unica mensagem de commit.

Regras rigidas:
- Formato Conventional Commits: "<tipo>: <descricao>" (tipos: feat, fix, refactor, style, docs, chore, test, perf, build, ci).
- Escreva em portugues, no imperativo, minusculas na descricao.
- Maximo 60 caracteres no total. Curta e especifica sobre o que mudou.
- Responda APENAS com a mensagem. Sem aspas, sem crases, sem explicacao, sem ponto final, sem quebra de linha extra.

Exemplos validos:
feat: adiciona geracao automatica de commit
fix: corrige validacao do campo de branch
refactor: extrai logica de copia para hook`,
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
      maxBuffer: 20 * 1024 * 1024,
      windowsHide: true,
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

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return "";

  for (let i = lines.length - 1; i >= 0; i--) {
    const candidate = stripEdges(lines[i]);
    if (CC_RE.test(candidate)) return candidate;
  }

  return stripEdges(lines[lines.length - 1]);
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
      max_tokens: 1200,
      messages: [
        { role: "system", content: PROMPTS[language] },
        { role: "user", content: `Diff das mudancas:\n\n${context}` },
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
      input: `Diff das mudancas:\n\n${context}`,
      max_output_tokens: 1200,
    }),
  });
}

async function readProviderError(res: Response, provider: Provider): Promise<string> {
  const text = await res.text().catch(() => "");
  let detail = `${PROVIDER_LABEL[provider]} respondeu ${res.status}`;
  try {
    const j = JSON.parse(text);
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
    return NextResponse.json({ error: "Requisicao invalida" }, { status: 400 });
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
    return NextResponse.json({ error: "Informe o caminho da pasta nas configuracoes" }, { status: 400 });
  }
  if (!apiKey) {
    return NextResponse.json({ error: `Informe a API key da ${PROVIDER_LABEL[provider]} nas configuracoes` }, { status: 400 });
  }

  const isRepo = (await git(path, ["rev-parse", "--is-inside-work-tree"])).trim();
  if (isRepo !== "true") {
    return NextResponse.json(
      { error: "A pasta nao e um repositorio git (ou o caminho nao existe)" },
      { status: 422 }
    );
  }

  let diff = await git(path, ["diff", "HEAD"]);
  if (!diff.trim()) diff = await git(path, ["diff"]);

  const untracked = (await git(path, ["ls-files", "--others", "--exclude-standard"])).trim();

  let context = diff;
  if (untracked) {
    context += `\n\nArquivos novos (nao rastreados):\n${untracked}`;
  }
  context = context.slice(0, 14000);

  if (!context.trim()) {
    return NextResponse.json(
      { error: "Nenhuma mudanca detectada no repositorio" },
      { status: 422 }
    );
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
      return NextResponse.json({ error: "O modelo nao retornou uma mensagem" }, { status: 502 });
    }

    return NextResponse.json({ message });
  } catch (e) {
    const msg = e instanceof Error ? e.message : `Falha ao contatar a ${PROVIDER_LABEL[provider]}`;
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
