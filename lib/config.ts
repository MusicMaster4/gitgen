/**
 * User-level gitgen config (OpenRouter key, model, language).
 * Pure path/IO helpers — safe to unit-test with temp dirs and env stubs.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type CommitLanguage = "en" | "pt";

export type GitgenConfig = {
  openRouterApiKey?: string;
  model?: string;
  language?: CommitLanguage;
};

export const DEFAULT_OPENROUTER_MODEL = "google/gemini-2.0-flash-001";
export const CONFIG_DIR_NAME = "gitgen";
export const CONFIG_FILE_NAME = "config.json";

type EnvLike = Record<string, string | undefined>;

/** Resolve the directory that holds config.json for this OS. */
export function getConfigDir(
  env: EnvLike = process.env,
  platform: NodeJS.Platform = process.platform
): string {
  if (env.GITGEN_CONFIG_DIR?.trim()) {
    return env.GITGEN_CONFIG_DIR.trim();
  }
  if (platform === "win32") {
    const base = env.APPDATA?.trim() || join(env.USERPROFILE || "", "AppData", "Roaming");
    return join(base, CONFIG_DIR_NAME);
  }
  if (platform === "darwin") {
    const home = env.HOME?.trim() || "";
    return join(home, "Library", "Application Support", CONFIG_DIR_NAME);
  }
  // Linux / others: XDG or ~/.config
  const xdg = env.XDG_CONFIG_HOME?.trim();
  if (xdg) return join(xdg, CONFIG_DIR_NAME);
  return join(env.HOME?.trim() || "", ".config", CONFIG_DIR_NAME);
}

export function getConfigPath(
  env: EnvLike = process.env,
  platform: NodeJS.Platform = process.platform
): string {
  return join(getConfigDir(env, platform), CONFIG_FILE_NAME);
}

export function parseConfigJson(raw: string): GitgenConfig {
  const data = JSON.parse(raw) as unknown;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return {};
  }
  const obj = data as Record<string, unknown>;
  const out: GitgenConfig = {};
  if (typeof obj.openRouterApiKey === "string") {
    out.openRouterApiKey = obj.openRouterApiKey.trim();
  }
  if (typeof obj.model === "string") {
    out.model = obj.model.trim();
  }
  if (obj.language === "en" || obj.language === "pt") {
    out.language = obj.language;
  }
  return out;
}

export function loadConfig(configPath: string): GitgenConfig {
  try {
    if (!existsSync(configPath)) return {};
    return parseConfigJson(readFileSync(configPath, "utf8"));
  } catch {
    return {};
  }
}

export function saveConfig(config: GitgenConfig, configPath: string): void {
  const dir = dirname(configPath);
  mkdirSync(dir, { recursive: true });
  const payload: GitgenConfig = {
    openRouterApiKey: config.openRouterApiKey?.trim() || undefined,
    model: (config.model?.trim() || DEFAULT_OPENROUTER_MODEL) as string,
    language: config.language === "pt" ? "pt" : "en",
  };
  writeFileSync(configPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

/** Mask API key for display (keep last 4 chars). */
export function maskApiKey(key: string): string {
  const k = key.trim();
  if (!k) return "(empty)";
  if (k.length <= 8) return "****";
  return `${k.slice(0, 4)}…${k.slice(-4)}`;
}

/**
 * Resolve effective OpenRouter settings.
 * Precedence: env vars > config file > defaults (model/language only).
 */
export function resolveRuntimeSettings(
  config: GitgenConfig,
  env: EnvLike = process.env
): {
  apiKey: string;
  model: string;
  language: CommitLanguage;
} {
  const apiKey = (
    env.OPENROUTER_API_KEY?.trim() ||
    config.openRouterApiKey?.trim() ||
    ""
  ).trim();
  const model = (
    env.OPENROUTER_MODEL?.trim() ||
    config.model?.trim() ||
    DEFAULT_OPENROUTER_MODEL
  ).trim();
  const langRaw = (env.COMMIT_LANGUAGE?.trim() || config.language || "en").toLowerCase();
  const language: CommitLanguage = langRaw === "pt" ? "pt" : "en";
  return { apiKey, model, language };
}
