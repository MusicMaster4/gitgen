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
