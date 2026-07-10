"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { sanitizeBranchName } from "../lib/branch-name";

/* ── helpers ── */
const DEFAULT_OPENROUTER_MODEL = "google/gemini-2.0-flash-001";
const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";

async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
}

const CopyIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    suppressHydrationWarning
  >
    <rect x="9" y="9" width="13" height="13" rx="1" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

type CardStatus = "idle" | "gen" | "copied" | "error";
interface CardState {
  status: CardStatus;
  error?: string;
}

function CopyRow({
  label = "Copy",
  color,
  onClick,
  secondary,
  state,
}: {
  label?: string;
  color?: string;
  onClick: () => void;
  secondary?: boolean;
  state?: CardState;
}) {
  const st = state?.status ?? "idle";
  return (
    <div className="copy-row">
      <button
        className={`btn-copy${secondary ? " secondary" : ""}`}
        onClick={onClick}
        disabled={st === "gen"}
      >
        <CopyIcon />
        {st === "gen" ? "Generating…" : label}
      </button>
      {st === "gen" && <span className="gen-badge">generating commit…</span>}
      {st === "copied" && <span className="copied-badge visible" style={color ? { color } : undefined}>✓ copied</span>}
      {st === "error" && <span className="gen-badge err">⚠ {state?.error}</span>}
    </div>
  );
}

/* ── config persistence ── */
type Language = "en" | "pt";
type Provider = "openrouter" | "openai";
interface Settings {
  folderPath: string;
  provider: Provider;
  openRouterApiKey: string;
  openRouterModel: string;
  openAiApiKey: string;
  openAiModel: string;
  language: Language;
}
const SETTINGS_KEY = "gcg.settings";
const RECENTS_KEY = "gcg.recentPaths";
const FOLDER_GATE_KEY = "gcg.folderGate";
const MAX_RECENTS = 8;

function normalizeFolderPath(p: string): string {
  return (p || "").trim().replace(/^["']+|["']+$/g, "");
}

function folderBasename(full: string): string {
  const cleaned = full.replace(/[\\/]+$/, "");
  const parts = cleaned.split(/[\\/]/);
  return parts[parts.length - 1] || full;
}

function readRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is string => typeof x === "string" && normalizeFolderPath(x) !== "")
      .map(normalizeFolderPath)
      .filter((p, i, arr) => arr.findIndex((q) => q.toLowerCase() === p.toLowerCase()) === i)
      .slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

function writeRecents(paths: string[]): string[] {
  const cleaned = paths
    .map(normalizeFolderPath)
    .filter(Boolean)
    .filter((p, i, arr) => arr.findIndex((q) => q.toLowerCase() === p.toLowerCase()) === i)
    .slice(0, MAX_RECENTS);
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(cleaned));
  } catch {
    /* ignore */
  }
  return cleaned;
}

function rememberPath(path: string, existing?: string[]): string[] {
  const n = normalizeFolderPath(path);
  if (!n) return existing ?? readRecents();
  const base = existing ?? readRecents();
  return writeRecents([n, ...base.filter((p) => p.toLowerCase() !== n.toLowerCase())]);
}

function stripPathQueryParam(): void {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("path")) return;
    url.searchParams.delete("path");
    const qs = url.searchParams.toString();
    const next = qs ? `${url.pathname}?${qs}${url.hash}` : `${url.pathname}${url.hash}`;
    window.history.replaceState({}, "", next);
  } catch {
    /* ignore */
  }
}

export interface EnvDefaults {
  provider: Provider;
  openRouterModel: string;
  openAiModel: string;
  language: Language;
  hasOpenRouterServerKey: boolean;
  hasOpenAiServerKey: boolean;
}

export default function HomeClient({ env }: { env: EnvDefaults }) {
  /* settings — folderPath é sempre definido no site; model/language têm default do .env */
  const [settings, setSettings] = useState<Settings>({
    folderPath: "",
    provider: env.provider,
    openRouterApiKey: "",
    openRouterModel: env.openRouterModel || DEFAULT_OPENROUTER_MODEL,
    openAiApiKey: "",
    openAiModel: env.openAiModel || DEFAULT_OPENAI_MODEL,
    language: env.language,
  });
  const [recents, setRecents] = useState<string[]>([]);
  const [folderReady, setFolderReady] = useState(false);
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [modalDraft, setModalDraft] = useState("");
  const [modalError, setModalError] = useState(false);
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    // Hidratação client-only do localStorage/URL: setState no mount é intencional
    // (inicializador lazy causaria mismatch de hidratação com o SSR).
    /* eslint-disable react-hooks/set-state-in-effect */
    let nextSettings: Settings = {
      folderPath: "",
      provider: env.provider,
      openRouterApiKey: "",
      openRouterModel: env.openRouterModel || DEFAULT_OPENROUTER_MODEL,
      openAiApiKey: "",
      openAiModel: env.openAiModel || DEFAULT_OPENAI_MODEL,
      language: env.language,
    };

    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Settings> & { apiKey?: string; model?: string };
        const provider: Provider =
          parsed.provider === "openai" ? "openai" : parsed.provider === "openrouter" ? "openrouter" : env.provider;
        nextSettings = {
          folderPath: normalizeFolderPath(parsed.folderPath || ""),
          provider,
          openRouterApiKey: parsed.openRouterApiKey || parsed.apiKey || "",
          openRouterModel: parsed.openRouterModel || parsed.model || env.openRouterModel || DEFAULT_OPENROUTER_MODEL,
          openAiApiKey: parsed.openAiApiKey || "",
          openAiModel: parsed.openAiModel || env.openAiModel || DEFAULT_OPENAI_MODEL,
          language: parsed.language === "pt" || parsed.language === "en" ? parsed.language : env.language,
        };
      }
    } catch {
      /* ignore */
    }

    let list = readRecents();
    if (nextSettings.folderPath) {
      list = rememberPath(nextSettings.folderPath, list);
    }

    const params = new URLSearchParams(window.location.search);
    const fromUrl = normalizeFolderPath(params.get("path") || "");

    if (fromUrl) {
      nextSettings = { ...nextSettings, folderPath: fromUrl };
      list = rememberPath(fromUrl, list);
      try {
        sessionStorage.setItem(FOLDER_GATE_KEY, "path");
      } catch {
        /* ignore */
      }
      stripPathQueryParam();
      setSettings(nextSettings);
      setRecents(list);
      setFolderReady(true);
      setShowFolderModal(false);
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(nextSettings));
      } catch {
        /* ignore */
      }
      return;
    }

    let gate: string | null = null;
    try {
      gate = sessionStorage.getItem(FOLDER_GATE_KEY);
    } catch {
      /* ignore */
    }

    setSettings(nextSettings);
    setRecents(list);

    if (gate === "path" || gate === "skip") {
      setFolderReady(true);
      setShowFolderModal(false);
    } else {
      setFolderReady(false);
      setShowFolderModal(true);
      setModalDraft(nextSettings.folderPath || "");
    }
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateSettings = (patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const applyFolderPath = useCallback((path: string) => {
    const n = normalizeFolderPath(path);
    if (!n) return false;
    updateSettings({ folderPath: n });
    setRecents(rememberPath(n));
    try {
      sessionStorage.setItem(FOLDER_GATE_KEY, "path");
    } catch {
      /* ignore */
    }
    setFolderReady(true);
    setShowFolderModal(false);
    setModalError(false);
    setModalDraft(n);
    return true;
  }, []);

  const skipFolder = useCallback(() => {
    updateSettings({ folderPath: "" });
    try {
      sessionStorage.setItem(FOLDER_GATE_KEY, "skip");
    } catch {
      /* ignore */
    }
    setFolderReady(true);
    setShowFolderModal(false);
    setModalError(false);
    setModalDraft("");
  }, []);

  const openFolderModal = useCallback(() => {
    setModalDraft(settingsRef.current.folderPath || "");
    setModalError(false);
    setShowFolderModal(true);
  }, []);

  const removeRecent = useCallback((path: string) => {
    setRecents((prev) => writeRecents(prev.filter((p) => p.toLowerCase() !== path.toLowerCase())));
  }, []);

  const hasKey =
    settings.provider === "openai"
      ? settings.openAiApiKey.trim() !== "" || env.hasOpenAiServerKey
      : settings.openRouterApiKey.trim() !== "" || env.hasOpenRouterServerKey;
  const canGenerate = settings.folderPath.trim() !== "" && hasKey;

  /* shared branch name (sincroniza criar / merge / mudar de branch) */
  const [branch, setBranch] = useState("");
  const onBranchChange = (v: string) => setBranch(sanitizeBranchName(v));

  /* commit messages */
  const [pushMsg, setPushMsg] = useState("");
  const [commitOnlyMsg, setCommitOnlyMsg] = useState("");
  const [branchMsg, setBranchMsg] = useState("");
  const [mergeMsg, setMergeMsg] = useState("");
  const [stashMsg, setStashMsg] = useState("");
  const [linkMsg, setLinkMsg] = useState("");

  /* other fields */
  const [repo, setRepo] = useState("");
  const [restoreFile, setRestoreFile] = useState("");

  /* ui state */
  const [cardState, setCardState] = useState<Record<string, CardState>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, boolean>>({});
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  /** timestamp por card — chave do elemento da barra (reinicia a animação de 30s) */
  const [msgCountdowns, setMsgCountdowns] = useState<Record<string, number>>({});
  const badgeTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const msgClearTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const setCard = useCallback((id: string, state: CardState) => {
    setCardState((prev) => ({ ...prev, [id]: state }));
  }, []);

  const flashCopied = useCallback((id: string) => {
    setCard(id, { status: "copied" });
    clearTimeout(badgeTimers.current[id]);
    badgeTimers.current[id] = setTimeout(() => {
      setCardState((prev) => (prev[id]?.status === "copied" ? { ...prev, [id]: { status: "idle" } } : prev));
    }, 1600);
  }, [setCard]);

  const scheduleMsgClear = useCallback((id: string, setMsg: (v: string) => void) => {
    clearTimeout(msgClearTimers.current[id]);
    const startedAt = Date.now();
    setMsgCountdowns((prev) => ({ ...prev, [id]: startedAt }));
    msgClearTimers.current[id] = setTimeout(() => {
      setMsg("");
      setMsgCountdowns((prev) => {
        if (prev[id] !== startedAt) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      delete msgClearTimers.current[id];
    }, 30_000);
  }, []);

  const cardClass = (id: string, extra = "") =>
    `card${extra ? ` ${extra}` : ""}${msgCountdowns[id] ? " countdown" : ""}${
      cardState[id]?.status === "gen" ? " generating" : ""
    }`;

  const cardCountdownBar = (id: string) =>
    msgCountdowns[id] ? <div key={msgCountdowns[id]} className="card-countdown" aria-hidden /> : null;

  const flashField = (name: string) => {
    setFieldErrors((prev) => ({ ...prev, [name]: false }));
    requestAnimationFrame(() => setFieldErrors((prev) => ({ ...prev, [name]: true })));
  };
  const clearField = (name: string) => setFieldErrors((prev) => (prev[name] ? { ...prev, [name]: false } : prev));

  const toggleSection = (id: string) => setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));

  /* ── command builders ── */
  const b = branch.trim() || "<branch>";
  const url = repo.trim() || "<repo_url>";
  const file = restoreFile.trim() || "<file>";

  const buildLink = (m: string) =>
    [
      `git init`,
      `git remote add origin ${url}`,
      `git add .`,
      `git commit -m "${m.trim() || "chore: initial commit"}"`,
      `git branch -M main`,
      `git push -u origin main`,
    ].join("\n") + "\n";

  const buildBranch = (m: string) =>
    [
      `git checkout -b ${b}`,
      `git add .`,
      `git commit -m "${m.trim() || "feat: new branch"}"`,
      `git push -u origin ${b}`,
    ].join("\n") + "\n";

  const buildMerge = (m: string) =>
    [
      `git add .`,
      `git commit -m "${m.trim() || `merge: integrate ${b} into main`}"`,
      `git checkout main`,
      `git merge ${b}`,
      `git push`,
    ].join("\n") + "\n";

  const buildStash = (m: string) =>
    [`git add .`, `git commit -m "${m.trim() || "wip: saving progress"}"`, `git checkout main`].join("\n") + "\n";

  const buildPush = (m: string) =>
    [`git add .`, `git commit -m "${m.trim() || "feat: update"}"`, `git push`].join("\n") + "\n";

  const buildCommitOnly = (m: string) =>
    [`git add .`, `git commit -m "${m.trim() || "feat: save progress"}"`].join("\n") + "\n";

  const outCheckout = `git checkout ${b}\n`;
  const outRestoreAll = `git restore .\n`;
  const outRestoreFile = `git restore ${file}\n`;

  /* ── AI commit generation + copy ── */
  /** Avoid double API hits when clicking several cards with empty msg (same repo snapshot). */
  const genCache = useRef<{ key: string; message: string; at: number } | null>(null);
  const GEN_CACHE_MS = 12_000;
  const inflightGen = useRef<Promise<string> | null>(null);

  const generateMessage = useCallback(async (): Promise<string> => {
    const { folderPath, provider, openRouterApiKey, openRouterModel, openAiApiKey, openAiModel, language } =
      settingsRef.current;
    const key = `${folderPath}\0${provider}\0${language}\0${openRouterModel}\0${openAiModel}`;
    const cached = genCache.current;
    if (cached && cached.key === key && Date.now() - cached.at < GEN_CACHE_MS) {
      return cached.message;
    }
    if (inflightGen.current) return inflightGen.current;

    const run = (async () => {
      const res = await fetch("/api/commit-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: folderPath,
          provider,
          openRouterApiKey,
          openRouterModel,
          openAiApiKey,
          openAiModel,
          language,
        }),
      });
      const data = (await res.json()) as { message?: string; error?: string };
      if (!res.ok || !data.message) {
        throw new Error(data.error || "Failed to generate message");
      }
      genCache.current = { key, message: data.message, at: Date.now() };
      return data.message;
    })();

    inflightGen.current = run;
    try {
      return await run;
    } finally {
      if (inflightGen.current === run) inflightGen.current = null;
    }
  }, []);

  /* copy de um card com auto-geração de commit (push / commitOnly / branch / merge) */
  const copyWithAI = useCallback(
    async (
      id: string,
      currentMsg: string,
      setMsg: (v: string) => void,
      build: (m: string) => string
    ) => {
      let msg = currentMsg.trim();
      if (canGenerate && !msg) {
        setCard(id, { status: "gen" });
        try {
          msg = await generateMessage();
          setMsg(msg);
        } catch (e) {
          const err = e instanceof Error ? e.message : "Failed to generate message";
          await copyToClipboard(build("")); // fallback with default message
          setCard(id, { status: "error", error: err });
          return;
        }
      }
      // Clipboard first so the user can paste ASAP; badge/state follow.
      await copyToClipboard(build(msg));
      flashCopied(id);
      // Sempre inicia a barra de 30s + reset da mensagem após copiar
      scheduleMsgClear(id, setMsg);
    },
    [canGenerate, generateMessage, setCard, flashCopied, scheduleMsgClear]
  );

  /* copy simples (sem IA) */
  const copySimple = useCallback(
    async (id: string, text: string) => {
      await copyToClipboard(text);
      flashCopied(id);
    },
    [flashCopied]
  );

  /* limpa timers ao desmontar */
  useEffect(() => {
    const badges = badgeTimers.current;
    const clears = msgClearTimers.current;
    return () => {
      Object.values(badges).forEach(clearTimeout);
      Object.values(clears).forEach(clearTimeout);
    };
  }, []);

  /* ── render helpers ── */
  const sectionCollapsed = (id: string) => collapsed[id] === true;
  const toggleLabel = (id: string) => (sectionCollapsed(id) ? "[ + ]" : "[ − ]");

  return (
    <div className="wrapper">
      <header>
        <div className="header-tag">{"// git command generator"}</div>
        <h1>
          GIT <span>CMD</span>
          <br />
          GENERATOR
        </h1>
        <p className="subtitle">Type it, copy it, done.</p>
        <div className="header-corner">v5.0 / AI</div>
      </header>

      {/* ── CONFIG ── */}
      <div className="section">
        <div className="section-header" onClick={() => toggleSection("cfg")} title="Show/hide">
          <span className="section-label">
            <span className="dot dot-blue" />
            Settings
          </span>
          <span className="section-toggle">{toggleLabel("cfg")}</span>
        </div>
        <div className={`section-content single${sectionCollapsed("cfg") ? " collapsed" : ""}`}>
          <div className="card blue">
            <div className="card-header">
              <span className="card-title">00 — Automatic commit generation</span>
              <span className="card-sub">folder + language → message</span>
            </div>
            <div className="card-body" style={{ gridTemplateColumns: "1fr" }}>
              <div>
                <div className="config-grid config-grid-folder">
                  <div>
                    <label htmlFor="folderPath">Project folder path</label>
                    <div className="folder-path-row">
                      <input
                        id="folderPath"
                        type="text"
                        placeholder="e.g. H:\\Projects\\my-app"
                        autoComplete="off"
                        spellCheck={false}
                        value={settings.folderPath}
                        onChange={(e) => updateSettings({ folderPath: e.target.value })}
                        onBlur={() => {
                          const n = normalizeFolderPath(settings.folderPath);
                          if (n) setRecents(rememberPath(n));
                        }}
                      />
                      <button type="button" className="btn-folder-pick" onClick={openFolderModal}>
                        Change
                      </button>
                    </div>
                    {recents.length > 0 && (
                      <div className="recent-inline" aria-label="Recent folders">
                        {recents.slice(0, 4).map((p) => (
                          <button
                            key={p}
                            type="button"
                            className={`recent-chip${settings.folderPath.toLowerCase() === p.toLowerCase() ? " active" : ""}`}
                            title={p}
                            onClick={() => applyFolderPath(p)}
                          >
                            {folderBasename(p)}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <label htmlFor="language">Commit language</label>
                    <select
                      id="language"
                      className="select-field"
                      value={settings.language}
                      onChange={(e) => updateSettings({ language: e.target.value === "pt" ? "pt" : "en" })}
                    >
                      <option value="en">English</option>
                      <option value="pt">Português</option>
                    </select>
                  </div>
                </div>
                <p className="config-status">
                  {canGenerate ? (
                    <>
                      Generation <b>active</b> — when you copy a commit with an empty message, it is generated from the
                      folder&apos;s <code>git diff</code>.
                    </>
                  ) : settings.folderPath.trim() ? (
                    <span className="off">Folder set — add an API key to generate messages with AI.</span>
                  ) : (
                    <span className="off">
                      No folder: the app still copies commands with manual messages. For AI, pick a folder (modal) or
                      launch with <code>gitgen</code> from your project terminal.
                    </span>
                  )}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── COMMITS ── */}
      <div className="section">
        <div className="section-header" onClick={() => toggleSection("s3")} title="Show/hide">
          <span className="section-label">
            <span className="dot dot-green" />
            Commits
          </span>
          <span className="section-toggle">{toggleLabel("s3")}</span>
        </div>
        <div className={`section-content${sectionCollapsed("s3") ? " collapsed" : ""}`}>
          {/* Commit + Push */}
          <div className={cardClass("push")}>
            {cardCountdownBar("push")}
            <div className="card-header">
              <span className="card-title">01 — Commit + Push</span>
              <span className="card-sub">git add . → commit → push</span>
            </div>
            <div className="card-body">
              <div>
                <label htmlFor="pushMsg">
                  Commit message {canGenerate && <span className="label-hint">(empty = AI generates)</span>}
                </label>
                <input
                  id="pushMsg"
                  type="text"
                  placeholder={canGenerate ? "leave empty for AI generation" : "<message>"}
                  autoComplete="off"
                  spellCheck={false}
                  value={pushMsg}
                  onChange={(e) => setPushMsg(e.target.value)}
                />
                <CopyRow state={cardState.push} onClick={() => copyWithAI("push", pushMsg, setPushMsg, buildPush)} />
              </div>
              <div>
                <div className="out-label-row">
                  <label>Output</label>
                </div>
                <textarea rows={6} spellCheck={false} readOnly value={buildPush(pushMsg)} />
              </div>
            </div>
          </div>

          {/* Só Commit */}
          <div className={cardClass("commitOnly")}>
            {cardCountdownBar("commitOnly")}
            <div className="card-header">
              <span className="card-title">02 — Commit Only (no push)</span>
              <span className="card-sub">git add . → commit</span>
            </div>
            <div className="card-body">
              <div>
                <label htmlFor="commitOnlyMsg">
                  Commit message {canGenerate && <span className="label-hint">(empty = AI generates)</span>}
                </label>
                <input
                  id="commitOnlyMsg"
                  type="text"
                  placeholder={canGenerate ? "leave empty for AI generation" : "<message>"}
                  autoComplete="off"
                  spellCheck={false}
                  value={commitOnlyMsg}
                  onChange={(e) => setCommitOnlyMsg(e.target.value)}
                />
                <CopyRow
                  state={cardState.commitOnly}
                  onClick={() => copyWithAI("commitOnly", commitOnlyMsg, setCommitOnlyMsg, buildCommitOnly)}
                />
              </div>
              <div>
                <div className="out-label-row">
                  <label>Output</label>
                </div>
                <textarea rows={5} spellCheck={false} readOnly value={buildCommitOnly(commitOnlyMsg)} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── BRANCHES ── */}
      <div className="section">
        <div className="section-header" onClick={() => toggleSection("s2")} title="Show/hide">
          <span className="section-label">
            <span className="dot dot-green" />
            Branches
          </span>
          <span className="section-toggle">{toggleLabel("s2")}</span>
        </div>
        <div className={`section-content${sectionCollapsed("s2") ? " collapsed" : ""}`}>
          {/* Criar Branch */}
          <div className={cardClass("branch")}>
            {cardCountdownBar("branch")}
            <div className="card-header">
              <span className="card-title">03 — Create Branch</span>
              <span className="card-sub">checkout -b → develop → commit → push</span>
            </div>
            <div className="card-body">
              <div>
                <div className="input-stack">
                  <div>
                    <label htmlFor="branch">Branch name</label>
                    <input
                      id="branch"
                      className={fieldErrors.branch ? "input-error" : ""}
                      type="text"
                      placeholder="<branch>"
                      autoComplete="off"
                      spellCheck={false}
                      value={branch}
                      onChange={(e) => {
                        onBranchChange(e.target.value);
                        clearField("branch");
                      }}
                    />
                    <span className={`field-error-msg${fieldErrors.branch ? " visible" : ""}`}>
                      ⚠ Branch name required
                    </span>
                  </div>
                  <div>
                    <label htmlFor="branchMsg">
                      Commit message{" "}
                      <span className="label-hint">{canGenerate ? "(empty = AI generates)" : "(optional)"}</span>
                    </label>
                    <input
                      id="branchMsg"
                      type="text"
                      placeholder={canGenerate ? "leave empty for AI generation" : "e.g. feat: initial commit"}
                      autoComplete="off"
                      spellCheck={false}
                      value={branchMsg}
                      onChange={(e) => setBranchMsg(e.target.value)}
                    />
                  </div>
                </div>
                <CopyRow
                  state={cardState.branch}
                  label="Copy all"
                  onClick={() => {
                    if (!branch.trim()) {
                      flashField("branch");
                      return;
                    }
                    copyWithAI("branch", branchMsg, setBranchMsg, buildBranch);
                  }}
                />
              </div>
              <div>
                <div className="out-label-row">
                  <label>Full sequence</label>
                </div>
                <textarea rows={6} spellCheck={false} readOnly value={buildBranch(branchMsg)} />
              </div>
            </div>
          </div>

          {/* Merge com Main */}
          <div className={cardClass("merge", "warning")}>
            {cardCountdownBar("merge")}
            <div className="card-header">
              <span className="card-title">04 — Merge into Main</span>
              <span className="card-sub">commit → checkout main → merge → push</span>
            </div>
            <div className="card-body">
              <div>
                <div className="input-stack">
                  <div>
                    <label htmlFor="mergeBranch">Your current branch</label>
                    <input
                      id="mergeBranch"
                      className={fieldErrors.mergeBranch ? "input-error" : ""}
                      type="text"
                      placeholder="<branch>  ex.: feature/login"
                      autoComplete="off"
                      spellCheck={false}
                      value={branch}
                      onChange={(e) => {
                        onBranchChange(e.target.value);
                        clearField("mergeBranch");
                      }}
                    />
                    <span className={`field-error-msg${fieldErrors.mergeBranch ? " visible" : ""}`}>
                      ⚠ Branch name required
                    </span>
                  </div>
                  <div>
                    <label htmlFor="mergeMsg">
                      Commit message{" "}
                      <span className="label-hint">{canGenerate ? "(empty = AI generates)" : "(optional)"}</span>
                    </label>
                    <input
                      id="mergeMsg"
                      type="text"
                      placeholder={canGenerate ? "leave empty for AI generation" : "e.g. feat: finish login"}
                      autoComplete="off"
                      spellCheck={false}
                      value={mergeMsg}
                      onChange={(e) => setMergeMsg(e.target.value)}
                    />
                  </div>
                </div>
                <CopyRow
                  state={cardState.merge}
                  label="Copy all"
                  color="var(--orange)"
                  onClick={() => {
                    if (!branch.trim()) {
                      flashField("mergeBranch");
                      return;
                    }
                    copyWithAI("merge", mergeMsg, setMergeMsg, buildMerge);
                  }}
                />
              </div>
              <div>
                <div className="out-label-row">
                  <label>Full sequence</label>
                </div>
                <textarea rows={6} spellCheck={false} readOnly value={buildMerge(mergeMsg)} />
                <div className="helper-block">
                  <label>Not sure of the branch name? Run this first:</label>
                  <div className="static-cmd">
                    <code>git branch --show-current</code>
                    <button
                      className="btn-copy-inline"
                      onClick={() => copySimple("showBranch", "git branch --show-current")}
                    >
                      <CopyIcon />
                      Copy
                    </button>
                  </div>
                  {cardState.showBranch?.status === "copied" && (
                    <span className="copied-badge visible" style={{ display: "block", marginTop: 6 }}>
                      ✓ copied
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Salvar Estado e Voltar ao Main (sem IA) */}
          <div className="card warning">
            <div className="card-header">
              <span className="card-title">05 — Save State and Return to Main</span>
              <span className="card-sub">add → commit → checkout main</span>
            </div>
            <div className="card-body">
              <div>
                <label htmlFor="stashMsg">
                  Commit message <span className="label-hint">(optional)</span>
                </label>
                <input
                  id="stashMsg"
                  type="text"
                  placeholder="e.g. wip: pausing login"
                  autoComplete="off"
                  spellCheck={false}
                  value={stashMsg}
                  onChange={(e) => setStashMsg(e.target.value)}
                />
                <p className="body-note">
                  Commits on the current branch to save state, then switches back to <code>main</code>. To resume,
                  run <code>git checkout &lt;branch&gt;</code> again.
                </p>
                <CopyRow state={cardState.stash} label="Copy all" color="var(--orange)" onClick={() => copySimple("stash", buildStash(stashMsg))} />
              </div>
              <div>
                <div className="out-label-row">
                  <label>Full sequence</label>
                </div>
                <textarea rows={6} spellCheck={false} readOnly value={buildStash(stashMsg)} />
              </div>
            </div>
          </div>

          {/* Mudar de Branch */}
          <div className="card warning">
            <div className="card-header">
              <span className="card-title">06 — Switch Branch</span>
              <span className="card-sub">git checkout &lt;branch&gt;</span>
            </div>
            <div className="card-body">
              <div>
                <label htmlFor="checkoutBranch">Target branch name</label>
                <input
                  id="checkoutBranch"
                  type="text"
                  placeholder="<branch>  ex.: main, feature/login"
                  autoComplete="off"
                  spellCheck={false}
                  value={branch}
                  onChange={(e) => onBranchChange(e.target.value)}
                />
                <p className="body-note">
                  Switch to any existing branch. Also use this to resume a branch where you previously saved state.
                </p>
                <CopyRow state={cardState.checkout} color="var(--orange)" onClick={() => copySimple("checkout", outCheckout)} />
              </div>
              <div>
                <div className="out-label-row">
                  <label>Output</label>
                </div>
                <textarea rows={3} spellCheck={false} readOnly value={outCheckout} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── CONFIGURAR REPOSITÓRIO ── */}
      <div className="section">
        <div className="section-header" onClick={() => toggleSection("s1")} title="Show/hide">
          <span className="section-label">
            <span className="dot dot-blue" />
            Repository Setup
          </span>
          <span className="section-toggle">{toggleLabel("s1")}</span>
        </div>
        <div className={`section-content single${sectionCollapsed("s1") ? " collapsed" : ""}`}>
          {/* Adicionar Remote (sem IA) */}
          <div className="card blue">
            <div className="card-header">
              <span className="card-title">07 — Add Remote (origin)</span>
              <span className="card-sub">git init → remote add → first push</span>
            </div>
            <div className="card-body">
              <div>
                <div className="input-stack">
                  <div>
                    <label htmlFor="repo">Repository URL</label>
                    <input
                      id="repo"
                      className={fieldErrors.repo ? "input-error" : ""}
                      type="url"
                      placeholder="<repo_url>"
                      autoComplete="off"
                      spellCheck={false}
                      value={repo}
                      onChange={(e) => {
                        setRepo(e.target.value);
                        clearField("repo");
                      }}
                    />
                    <span className={`field-error-msg${fieldErrors.repo ? " visible" : ""}`}>
                      ⚠ URL required to copy
                    </span>
                  </div>
                  <div>
                    <label htmlFor="linkMsg">
                      Commit message <span className="label-hint">(optional)</span>
                    </label>
                    <input
                      id="linkMsg"
                      type="text"
                      placeholder="e.g. chore: initial commit"
                      autoComplete="off"
                      spellCheck={false}
                      value={linkMsg}
                      onChange={(e) => setLinkMsg(e.target.value)}
                    />
                  </div>
                </div>
                <CopyRow
                  state={cardState.link}
                  label="Copy all"
                  color="var(--blue)"
                  onClick={() => {
                    if (!repo.trim()) {
                      flashField("repo");
                      return;
                    }
                    copySimple("link", buildLink(linkMsg));
                  }}
                />
              </div>
              <div>
                <div className="out-label-row">
                  <label>Full sequence</label>
                </div>
                <textarea rows={6} spellCheck={false} readOnly value={buildLink(linkMsg)} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── DESFAZER MUDANÇAS ── */}
      <div className="section">
        <div className="section-header" onClick={() => toggleSection("s4")} title="Show/hide">
          <span className="section-label">
            <span className="dot dot-red" />
            Undo Changes
          </span>
          <span className="section-toggle">{toggleLabel("s4")}</span>
        </div>
        <div className={`section-content${sectionCollapsed("s4") ? " collapsed" : ""}`}>
          {/* Restaurar Todos */}
          <div className="card danger">
            <div className="card-header">
              <span className="card-title">08 — Restore All Files</span>
              <span className="card-sub">git restore .</span>
            </div>
            <div className="card-body">
              <div>
                <div className="warn-banner">
                  <span className="warn-icon">⚠</span>
                  Destructive — discards ALL uncommitted changes. Cannot be undone.
                </div>
                <p className="card-desc" suppressHydrationWarning>
                  Restores all tracked files to the state of the last commit.
                </p>
                <CopyRow state={cardState.restoreAll} color="var(--red)" onClick={() => copySimple("restoreAll", outRestoreAll)} />
              </div>
              <div>
                <div className="out-label-row">
                  <label>Output</label>
                </div>
                <textarea rows={3} spellCheck={false} readOnly value={outRestoreAll} />
              </div>
            </div>
          </div>

          {/* Restaurar Arquivo */}
          <div className="card danger">
            <div className="card-header">
              <span className="card-title">09 — Restore Specific File</span>
              <span className="card-sub">git restore &lt;file&gt;</span>
            </div>
            <div className="card-body">
              <div>
                <div className="warn-banner">
                  <span className="warn-icon">⚠</span>
                  Destructive — discards changes to the specified file. Cannot be undone.
                </div>
                <label htmlFor="restoreFile">File path</label>
                <input
                  id="restoreFile"
                  className={fieldErrors.restoreFile ? "input-error" : ""}
                  type="text"
                  placeholder="<file>  e.g. src/index.js"
                  autoComplete="off"
                  spellCheck={false}
                  value={restoreFile}
                  onChange={(e) => {
                    setRestoreFile(e.target.value);
                    clearField("restoreFile");
                  }}
                />
                <span className={`field-error-msg${fieldErrors.restoreFile ? " visible" : ""}`}>
                  ⚠ File path required
                </span>
                <CopyRow
                  state={cardState.restoreFile}
                  color="var(--red)"
                  onClick={() => {
                    if (!restoreFile.trim()) {
                      flashField("restoreFile");
                      return;
                    }
                    copySimple("restoreFile", outRestoreFile);
                  }}
                />
              </div>
              <div>
                <div className="out-label-row">
                  <label>Output</label>
                </div>
                <textarea rows={3} spellCheck={false} readOnly value={outRestoreFile} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Modal: escolher pasta do projeto ── */}
      {showFolderModal && (
        <div
          className="folder-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="folder-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget && folderReady) setShowFolderModal(false);
          }}
        >
          <div className="folder-modal">
            <div className="folder-modal-tag">{"// local project"}</div>
            <h2 id="folder-modal-title">
              Which folder are <span>you</span>
              <br />
              working in?
            </h2>
            <p className="folder-modal-sub">
              Opened via <code>.bat</code> or directly in the browser — pick a recent folder or paste the path. From the
              terminal with <code>gitgen</code>, the folder is filled in automatically.
            </p>

            {recents.length > 0 && (
              <div className="folder-modal-section">
                <span className="folder-modal-label">Recent folders</span>
                <ul className="folder-recent-list">
                  {recents.map((p) => (
                    <li key={p}>
                      <button type="button" className="folder-recent-item" onClick={() => applyFolderPath(p)} title={p}>
                        <span className="folder-recent-name">{folderBasename(p)}</span>
                        <span className="folder-recent-path">{p}</span>
                      </button>
                      <button
                        type="button"
                        className="folder-recent-remove"
                        aria-label={`Remove ${folderBasename(p)} from recents`}
                        onClick={() => removeRecent(p)}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="folder-modal-section">
              <label className="folder-modal-label" htmlFor="modalFolderPath">
                {recents.length > 0 ? "Or paste a new path" : "Paste your project folder path"}
              </label>
              <input
                id="modalFolderPath"
                type="text"
                className={modalError ? "input-error" : ""}
                placeholder="e.g. H:\Projects\my-app"
                autoComplete="off"
                spellCheck={false}
                autoFocus
                value={modalDraft}
                onChange={(e) => {
                  setModalDraft(e.target.value);
                  setModalError(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (!applyFolderPath(modalDraft)) setModalError(true);
                  }
                }}
              />
              {modalError && <span className="field-error-msg visible">⚠ Paste a valid folder path</span>}
            </div>

            <div className="folder-modal-actions">
              <button
                type="button"
                className="btn-copy"
                onClick={() => {
                  if (!applyFolderPath(modalDraft)) setModalError(true);
                }}
              >
                Use this folder
              </button>
              <button type="button" className="btn-copy secondary" onClick={skipFolder}>
                Continue without folder
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
