import { NextRequest, NextResponse } from "next/server";
import {
  CommitMessageError,
  DEFAULT_MODELS,
  PROVIDER_LABEL,
  Provider,
  generateCommitMessage,
} from "@/lib/commit-message";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

/**
 * Same-origin guard: this route runs git against an arbitrary local path, so a
 * malicious webpage must not be able to POST to it from the user's browser.
 * Browsers always send `Origin` on cross-origin POSTs — reject when it doesn't
 * match the request host. Requests without an Origin (curl, the CLI, same-app
 * server calls) are allowed, so the UI and terminal workflows are unaffected.
 */
function isCrossOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const host = req.headers.get("host");
  if (!host) return true;
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

export async function POST(req: NextRequest) {
  if (isCrossOrigin(req)) {
    return NextResponse.json({ error: "Cross-origin requests are not allowed" }, { status: 403 });
  }

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

  try {
    const message = await generateCommitMessage({ path, provider, apiKey, model, language });
    return NextResponse.json({ message });
  } catch (e) {
    if (e instanceof CommitMessageError) {
      // Repo/no-changes issues are client-fixable (4xx); provider issues are upstream (502).
      const status = /git repository|No changes/.test(e.message) ? 422 : 502;
      return NextResponse.json({ error: e.message }, { status });
    }
    const msg = e instanceof Error ? e.message : `Failed to reach ${PROVIDER_LABEL[provider]}`;
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
