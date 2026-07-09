"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* ── helpers ── */
const DEFAULT_OPENROUTER_MODEL = "google/gemini-2.0-flash-001";
const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";

function normalizeBranch(v: string): string {
  return (v || "").replace(/[_\s]+/g, "-").replace(/-+/g, "-");
}

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
  label = "Copiar",
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
        {st === "gen" ? "Gerando…" : label}
      </button>
      {st === "gen" && <span className="gen-badge">gerando commit…</span>}
      {st === "copied" && <span className="copied-badge visible" style={color ? { color } : undefined}>✓ copiado</span>}
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
  const onBranchChange = (v: string) => setBranch(normalizeBranch(v));

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
    `card${extra ? ` ${extra}` : ""}${msgCountdowns[id] ? " countdown" : ""}`;

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
  const file = restoreFile.trim() || "<arquivo>";

  const buildLink = (m: string) =>
    [
      `git init`,
      `git remote add origin ${url}`,
      `git add .`,
      `git commit -m "${m.trim() || "chore: commit inicial"}"`,
      `git branch -M main`,
      `git push -u origin main`,
    ].join("\n") + "\n";

  const buildBranch = (m: string) =>
    [
      `git checkout -b ${b}`,
      `git add .`,
      `git commit -m "${m.trim() || "feat: novo branch"}"`,
      `git push -u origin ${b}`,
    ].join("\n") + "\n";

  const buildMerge = (m: string) =>
    [
      `git add .`,
      `git commit -m "${m.trim() || `merge: integrando ${b} na main`}"`,
      `git checkout main`,
      `git merge ${b}`,
      `git push`,
    ].join("\n") + "\n";

  const buildStash = (m: string) =>
    [`git add .`, `git commit -m "${m.trim() || "wip: salvando progresso"}"`, `git checkout main`].join("\n") + "\n";

  const buildPush = (m: string) =>
    [`git add .`, `git commit -m "${m.trim() || "feat: atualização"}"`, `git push`].join("\n") + "\n";

  const buildCommitOnly = (m: string) =>
    [`git add .`, `git commit -m "${m.trim() || "feat: salvando progresso"}"`].join("\n") + "\n";

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
        throw new Error(data.error || "Falha ao gerar mensagem");
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
          const err = e instanceof Error ? e.message : "Falha ao gerar mensagem";
          await copyToClipboard(build("")); // copia com mensagem padrão como fallback
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
        <p className="subtitle">Escreve, o comando aparece. Sem frescura.</p>
        <div className="header-corner">v5.0 / AI</div>
      </header>

      {/* ── CONFIG ── */}
      <div className="section">
        <div className="section-header" onClick={() => toggleSection("cfg")} title="Mostrar/esconder">
          <span className="section-label">
            <span className="dot dot-blue" />
            Configuração
          </span>
          <span className="section-toggle">{toggleLabel("cfg")}</span>
        </div>
        <div className={`section-content single${sectionCollapsed("cfg") ? " collapsed" : ""}`}>
          <div className="card blue">
            <div className="card-header">
              <span className="card-title">00 — Geração automática de commit</span>
              <span className="card-sub">pasta + idioma → mensagem</span>
            </div>
            <div className="card-body" style={{ gridTemplateColumns: "1fr" }}>
              <div>
                <div className="config-grid config-grid-folder">
                  <div>
                    <label htmlFor="folderPath">Caminho da pasta do projeto</label>
                    <div className="folder-path-row">
                      <input
                        id="folderPath"
                        type="text"
                        placeholder="ex.: H:\\Meus Projetos\\app"
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
                        Trocar
                      </button>
                    </div>
                    {recents.length > 0 && (
                      <div className="recent-inline" aria-label="Pastas recentes">
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
                    <label htmlFor="language">Idioma do commit</label>
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
                      Geração <b>ativa</b> — ao copiar um commit com a mensagem vazia, ela é gerada a partir do{" "}
                      <code>git diff</code> da pasta.
                    </>
                  ) : settings.folderPath.trim() ? (
                    <span className="off">Pasta definida — falta chave da API para gerar mensagens com IA.</span>
                  ) : (
                    <span className="off">
                      Sem pasta: o app ainda copia comandos com mensagens manuais. Para IA, escolha uma pasta (modal) ou
                      abra com <code>gitgen</code> no terminal do projeto.
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
        <div className="section-header" onClick={() => toggleSection("s3")} title="Mostrar/esconder">
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
                  Mensagem do commit {canGenerate && <span className="label-hint">(vazio = IA gera)</span>}
                </label>
                <input
                  id="pushMsg"
                  type="text"
                  placeholder={canGenerate ? "deixe vazio para gerar com IA" : "<mensagem>"}
                  autoComplete="off"
                  spellCheck={false}
                  value={pushMsg}
                  onChange={(e) => setPushMsg(e.target.value)}
                />
                <CopyRow state={cardState.push} onClick={() => copyWithAI("push", pushMsg, setPushMsg, buildPush)} />
              </div>
              <div>
                <div className="out-label-row">
                  <label>Saída</label>
                </div>
                <textarea rows={6} spellCheck={false} readOnly value={buildPush(pushMsg)} />
              </div>
            </div>
          </div>

          {/* Só Commit */}
          <div className={cardClass("commitOnly")}>
            {cardCountdownBar("commitOnly")}
            <div className="card-header">
              <span className="card-title">02 — Só Commit (sem push)</span>
              <span className="card-sub">git add . → commit</span>
            </div>
            <div className="card-body">
              <div>
                <label htmlFor="commitOnlyMsg">
                  Mensagem do commit {canGenerate && <span className="label-hint">(vazio = IA gera)</span>}
                </label>
                <input
                  id="commitOnlyMsg"
                  type="text"
                  placeholder={canGenerate ? "deixe vazio para gerar com IA" : "<mensagem>"}
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
                  <label>Saída</label>
                </div>
                <textarea rows={5} spellCheck={false} readOnly value={buildCommitOnly(commitOnlyMsg)} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── BRANCHES ── */}
      <div className="section">
        <div className="section-header" onClick={() => toggleSection("s2")} title="Mostrar/esconder">
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
              <span className="card-title">03 — Criar Branch</span>
              <span className="card-sub">checkout -b → desenvolver → commit → push</span>
            </div>
            <div className="card-body">
              <div>
                <div className="input-stack">
                  <div>
                    <label htmlFor="branch">Nome do branch</label>
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
                      ⚠ Nome do branch obrigatório
                    </span>
                  </div>
                  <div>
                    <label htmlFor="branchMsg">
                      Mensagem do commit{" "}
                      <span className="label-hint">{canGenerate ? "(vazio = IA gera)" : "(opcional)"}</span>
                    </label>
                    <input
                      id="branchMsg"
                      type="text"
                      placeholder={canGenerate ? "deixe vazio para gerar com IA" : "ex.: feat: initial commit"}
                      autoComplete="off"
                      spellCheck={false}
                      value={branchMsg}
                      onChange={(e) => setBranchMsg(e.target.value)}
                    />
                  </div>
                </div>
                <CopyRow
                  state={cardState.branch}
                  label="Copiar tudo"
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
                  <label>Sequência completa</label>
                </div>
                <textarea rows={6} spellCheck={false} readOnly value={buildBranch(branchMsg)} />
              </div>
            </div>
          </div>

          {/* Merge com Main */}
          <div className={cardClass("merge", "warning")}>
            {cardCountdownBar("merge")}
            <div className="card-header">
              <span className="card-title">04 — Merge com Main</span>
              <span className="card-sub">commit → checkout main → merge → push</span>
            </div>
            <div className="card-body">
              <div>
                <div className="input-stack">
                  <div>
                    <label htmlFor="mergeBranch">Seu branch atual</label>
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
                      ⚠ Nome do branch obrigatório
                    </span>
                  </div>
                  <div>
                    <label htmlFor="mergeMsg">
                      Mensagem do commit{" "}
                      <span className="label-hint">{canGenerate ? "(vazio = IA gera)" : "(opcional)"}</span>
                    </label>
                    <input
                      id="mergeMsg"
                      type="text"
                      placeholder={canGenerate ? "deixe vazio para gerar com IA" : "ex.: feat: finaliza login"}
                      autoComplete="off"
                      spellCheck={false}
                      value={mergeMsg}
                      onChange={(e) => setMergeMsg(e.target.value)}
                    />
                  </div>
                </div>
                <CopyRow
                  state={cardState.merge}
                  label="Copiar tudo"
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
                  <label>Sequência completa</label>
                </div>
                <textarea rows={6} spellCheck={false} readOnly value={buildMerge(mergeMsg)} />
                <div className="helper-block">
                  <label>Não sabe o nome do branch? Rode isso primeiro:</label>
                  <div className="static-cmd">
                    <code>git branch --show-current</code>
                    <button
                      className="btn-copy-inline"
                      onClick={() => copySimple("showBranch", "git branch --show-current")}
                    >
                      <CopyIcon />
                      Copiar
                    </button>
                  </div>
                  {cardState.showBranch?.status === "copied" && (
                    <span className="copied-badge visible" style={{ display: "block", marginTop: 6 }}>
                      ✓ copiado
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Salvar Estado e Voltar ao Main (sem IA) */}
          <div className="card warning">
            <div className="card-header">
              <span className="card-title">05 — Salvar Estado e Voltar ao Main</span>
              <span className="card-sub">add → commit → checkout main</span>
            </div>
            <div className="card-body">
              <div>
                <label htmlFor="stashMsg">
                  Mensagem do commit <span className="label-hint">(opcional)</span>
                </label>
                <input
                  id="stashMsg"
                  type="text"
                  placeholder="ex.: wip: pausando login"
                  autoComplete="off"
                  spellCheck={false}
                  value={stashMsg}
                  onChange={(e) => setStashMsg(e.target.value)}
                />
                <p className="body-note">
                  Faz um commit no branch atual salvando o estado, depois volta pro <code>main</code>. Para retomar,
                  basta dar <code>git checkout &lt;branch&gt;</code> de novo.
                </p>
                <CopyRow state={cardState.stash} label="Copiar tudo" color="var(--orange)" onClick={() => copySimple("stash", buildStash(stashMsg))} />
              </div>
              <div>
                <div className="out-label-row">
                  <label>Sequência completa</label>
                </div>
                <textarea rows={6} spellCheck={false} readOnly value={buildStash(stashMsg)} />
              </div>
            </div>
          </div>

          {/* Mudar de Branch */}
          <div className="card warning">
            <div className="card-header">
              <span className="card-title">06 — Mudar de Branch</span>
              <span className="card-sub">git checkout &lt;branch&gt;</span>
            </div>
            <div className="card-body">
              <div>
                <label htmlFor="checkoutBranch">Nome do branch de destino</label>
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
                  Muda para qualquer branch existente. Use também para retomar um branch onde você salvou o estado
                  anteriormente.
                </p>
                <CopyRow state={cardState.checkout} color="var(--orange)" onClick={() => copySimple("checkout", outCheckout)} />
              </div>
              <div>
                <div className="out-label-row">
                  <label>Saída</label>
                </div>
                <textarea rows={3} spellCheck={false} readOnly value={outCheckout} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── CONFIGURAR REPOSITÓRIO ── */}
      <div className="section">
        <div className="section-header" onClick={() => toggleSection("s1")} title="Mostrar/esconder">
          <span className="section-label">
            <span className="dot dot-blue" />
            Configurar Repositório
          </span>
          <span className="section-toggle">{toggleLabel("s1")}</span>
        </div>
        <div className={`section-content single${sectionCollapsed("s1") ? " collapsed" : ""}`}>
          {/* Adicionar Remote (sem IA) */}
          <div className="card blue">
            <div className="card-header">
              <span className="card-title">07 — Adicionar Remote (origin)</span>
              <span className="card-sub">git init → remote add → primeiro push</span>
            </div>
            <div className="card-body">
              <div>
                <div className="input-stack">
                  <div>
                    <label htmlFor="repo">URL do repositório</label>
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
                      ⚠ URL obrigatória para copiar
                    </span>
                  </div>
                  <div>
                    <label htmlFor="linkMsg">
                      Mensagem do commit <span className="label-hint">(opcional)</span>
                    </label>
                    <input
                      id="linkMsg"
                      type="text"
                      placeholder="ex.: chore: commit inicial"
                      autoComplete="off"
                      spellCheck={false}
                      value={linkMsg}
                      onChange={(e) => setLinkMsg(e.target.value)}
                    />
                  </div>
                </div>
                <CopyRow
                  state={cardState.link}
                  label="Copiar tudo"
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
                  <label>Sequência completa</label>
                </div>
                <textarea rows={6} spellCheck={false} readOnly value={buildLink(linkMsg)} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── DESFAZER MUDANÇAS ── */}
      <div className="section">
        <div className="section-header" onClick={() => toggleSection("s4")} title="Mostrar/esconder">
          <span className="section-label">
            <span className="dot dot-red" />
            Desfazer Mudanças
          </span>
          <span className="section-toggle">{toggleLabel("s4")}</span>
        </div>
        <div className={`section-content${sectionCollapsed("s4") ? " collapsed" : ""}`}>
          {/* Restaurar Todos */}
          <div className="card danger">
            <div className="card-header">
              <span className="card-title">08 — Restaurar Todos os Arquivos</span>
              <span className="card-sub">git restore .</span>
            </div>
            <div className="card-body">
              <div>
                <div className="warn-banner">
                  <span className="warn-icon">⚠</span>
                  Destrutivo — descarta TODAS as mudanças não commitadas. Não tem desfazer.
                </div>
                <p className="card-desc" suppressHydrationWarning>
                  Restaura todos os arquivos rastreados ao estado do último commit.
                </p>
                <CopyRow state={cardState.restoreAll} color="var(--red)" onClick={() => copySimple("restoreAll", outRestoreAll)} />
              </div>
              <div>
                <div className="out-label-row">
                  <label>Saída</label>
                </div>
                <textarea rows={3} spellCheck={false} readOnly value={outRestoreAll} />
              </div>
            </div>
          </div>

          {/* Restaurar Arquivo */}
          <div className="card danger">
            <div className="card-header">
              <span className="card-title">09 — Restaurar Arquivo Específico</span>
              <span className="card-sub">git restore &lt;arquivo&gt;</span>
            </div>
            <div className="card-body">
              <div>
                <div className="warn-banner">
                  <span className="warn-icon">⚠</span>
                  Destrutivo — descarta as mudanças do arquivo indicado. Não tem desfazer.
                </div>
                <label htmlFor="restoreFile">Caminho do arquivo</label>
                <input
                  id="restoreFile"
                  className={fieldErrors.restoreFile ? "input-error" : ""}
                  type="text"
                  placeholder="<arquivo>  ex.: src/index.js"
                  autoComplete="off"
                  spellCheck={false}
                  value={restoreFile}
                  onChange={(e) => {
                    setRestoreFile(e.target.value);
                    clearField("restoreFile");
                  }}
                />
                <span className={`field-error-msg${fieldErrors.restoreFile ? " visible" : ""}`}>
                  ⚠ Caminho do arquivo obrigatório
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
                  <label>Saída</label>
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
            <div className="folder-modal-tag">{"// projeto local"}</div>
            <h2 id="folder-modal-title">
              Qual pasta <span>você está</span>
              <br />
              trabalhando?
            </h2>
            <p className="folder-modal-sub">
              Abriu pelo <code>.bat</code> ou direto no browser — escolha uma recente ou cole o caminho. Pelo terminal
              com <code>gitgen</code>, a pasta já vem preenchida.
            </p>

            {recents.length > 0 && (
              <div className="folder-modal-section">
                <span className="folder-modal-label">Pastas recentes</span>
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
                        aria-label={`Remover ${folderBasename(p)} dos recentes`}
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
                {recents.length > 0 ? "Ou cole um caminho novo" : "Cole o caminho da pasta do projeto"}
              </label>
              <input
                id="modalFolderPath"
                type="text"
                className={modalError ? "input-error" : ""}
                placeholder="ex.: H:\Python\meu-app"
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
              {modalError && <span className="field-error-msg visible">⚠ Cole um caminho válido da pasta</span>}
            </div>

            <div className="folder-modal-actions">
              <button
                type="button"
                className="btn-copy"
                onClick={() => {
                  if (!applyFolderPath(modalDraft)) setModalError(true);
                }}
              >
                Usar esta pasta
              </button>
              <button type="button" className="btn-copy secondary" onClick={skipFolder}>
                Continuar sem pasta
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
