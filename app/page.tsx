import HomeClient from "./HomeClient";

export const dynamic = "force-dynamic";

export default function Page() {
  const language = process.env.COMMIT_LANGUAGE === "pt" ? "pt" : "en";
  const provider = process.env.AI_PROVIDER === "openai" ? "openai" : "openrouter";
  return (
    <HomeClient
      env={{
        provider,
        openRouterModel: (process.env.OPENROUTER_MODEL ?? "").trim(),
        openAiModel: (process.env.OPENAI_MODEL ?? "").trim(),
        language,
        hasOpenRouterServerKey: (process.env.OPENROUTER_API_KEY ?? "").trim() !== "",
        hasOpenAiServerKey: (process.env.OPENAI_API_KEY ?? "").trim() !== "",
      }}
    />
  );
}
