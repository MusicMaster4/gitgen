<div align="center">

# Git Command Generator

**Type it, copy it, done.**

A local Next.js tool that builds ready-to-paste Git workflows — and generates Conventional Commit messages with AI from your real `git diff`.

<p>
  <img src="https://img.shields.io/badge/Next.js-16-black?style=for-the-badge&logo=nextdotjs" alt="Next.js" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Tailwind-4-38B2AC?style=for-the-badge&logo=tailwindcss&logoColor=white" alt="Tailwind" />
  <img src="https://img.shields.io/badge/Bun-ready-fbf0df?style=for-the-badge&logo=bun&logoColor=black" alt="Bun" />
</p>

<p>
  <a href="#quick-start"><strong>Quick Start</strong></a> ·
  <a href="#features"><strong>Features</strong></a> ·
  <a href="#ai-commit-generation"><strong>AI Commits</strong></a> ·
  <a href="#terminal-shortcut"><strong>gitgen</strong></a> ·
  <a href="#security"><strong>Security</strong></a>
</p>

</div>

---

## Why this exists

Git is powerful. Remembering every flag and sequence is not.

**Git Command Generator** gives you multi-step command blocks for everyday workflows — commit, push, branch, merge, stash, restore — in one click. Leave the commit message empty and AI reads your local diff to write a short Conventional Commit for you.

No accounts. No cloud repo access. Just your machine, your folder, your terminal.

---

## Features

<table>
<tr>
<td width="50%" valign="top">

### Ready-made workflows

Copy full command sequences for:

- First push & remote setup
- Commit + push
- Commit only (no push)
- Create branch
- Merge into `main`
- Save state & switch back
- Checkout any branch
- Restore all files or one file

Each card shows live output as you type.

</td>
<td width="50%" valign="top">

### AI commit messages

- Reads `git status`, name-status, and diff from **your** project folder
- OpenRouter **or** OpenAI (server key or UI)
- Conventional Commits format (`feat:`, `fix:`, `chore:`, …)
- English or Portuguese output
- 12s in-memory cache — no duplicate API hits when clicking multiple cards

</td>
</tr>
<tr>
<td width="50%" valign="top">

### Developer ergonomics

- One-click copy on every card
- Recent folders in `localStorage`
- Folder picker modal on first launch
- `gitgen` CLI opens the app with `?path=` from any repo
- Collapsible sections, field validation, 30s message auto-clear

</td>
<td width="50%" valign="top">

### Local-first

- Runs on `localhost:2001`
- API route executes `git` on your filesystem
- Preferences stored in the browser
- Keys stay in `.env.local` or localStorage — never in git

</td>
</tr>
</table>

---

## How it works

```mermaid
flowchart LR
    A[Your repo] -->|gitgen or modal| B[Git Command Generator]
    B --> C{Empty commit message?}
    C -->|No| D[Build command block]
    C -->|Yes + API key| E[/api/commit-message]
    E -->|git status + diff| F[Local git]
    E -->|context| G[OpenRouter / OpenAI]
    G -->|Conventional Commit| D
    D --> H[Clipboard]
```

1. Point the app at your project folder.
2. Make changes in your real repo.
3. Click **Copy** on a workflow card.
4. Paste into your terminal. Done.

---

## Quick start

### Prerequisites

- [Bun](https://bun.sh) (recommended) or Node 18+
- Git installed and on your `PATH`

### 1 · Clone & install

```bash
git clone https://github.com/MusicMaster4/git-command-generator.git
cd git-command-generator
bun install
```

### 2 · Environment

```bash
cp .env.example .env.local
```

Edit `.env.local` — **never commit this file**:

```env
AI_PROVIDER=openrouter          # openrouter | openai

OPENROUTER_API_KEY=
OPENROUTER_MODEL=google/gemini-2.0-flash-001

OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.4-mini

COMMIT_LANGUAGE=en              # en | pt
```

| Variable | Description |
|----------|-------------|
| `AI_PROVIDER` | Default provider shown in the UI |
| `OPENROUTER_*` / `OPENAI_*` | Server-side API keys & models |
| `COMMIT_LANGUAGE` | Default language for AI commit messages |

> Keys can live in `.env.local` **or** be entered in the UI — or both. Server keys are preferred for local use.

### 3 · Run

```bash
bun run dev
```

Open **[http://localhost:2001](http://localhost:2001)** — or double-click `start-dev.bat` on Windows.

On first launch (without `?path=`), a modal asks for your project folder: pick a **recent** path or **paste** one.

### Scripts

| Command | What it does |
|---------|--------------|
| `bun run dev` | Dev server on port **2001** |
| `bun run build` | Production build |
| `bun run start` | Serve the build (port 2001) |
| `bun run lint` | ESLint |
| `bun run typecheck` | TypeScript check |
| `bun run here` | Open app with **current directory** (`?path=`) |

---

## Terminal shortcut

From **any** project directory:

```bash
gitgen
```

| Server state | Behavior |
|--------------|----------|
| Already running on `localhost:2001` | Opens browser with `?path=` for current folder |
| Offline | Starts `bun run dev` in background, waits, then opens browser |

Equivalent to `scripts/open-here.ps1` / `open-here.mjs`. Add `scripts/` to your user `PATH` once:

```powershell
# Example (adjust to your clone path):
# H:\Python\Slop\git-command-generator\scripts
```

| Env var | Default | Purpose |
|---------|---------|---------|
| `GCG_PORT` | `2001` | Custom port |
| `GCG_TIMEOUT` | varies | Startup wait (seconds) |

---

## AI commit generation

### Setup

1. **Folder** — via `gitgen`, the startup modal, or **Settings → Change**
2. **Provider & model** — OpenRouter or OpenAI
3. **API key** — in `.env.local` and/or the UI
4. **Language** — English or Portuguese for generated messages

### Usage

1. Edit files in your real repo.
2. Open a card (Commit + Push, Create Branch, etc.).
3. Leave the commit message **empty**.
4. Click **Copy**.

The API runs `git` locally, sends a compact diff to the model, and builds the full command block with the generated message.

Without a key or valid folder, cards still copy commands using sensible default messages.

Recent folders are saved in `localStorage` for the next session.

---

## Security

> **Treat API keys like passwords.**

| Item | Committed to git? |
|------|-------------------|
| `.env.local` (real keys) | **No** — gitignored |
| `.env.example` (placeholders) | Yes — safe template |
| Keys typed in the UI | Browser `localStorage` only |
| `node_modules/`, `.next/`, logs | **No** |

**Rules:**

- Never commit `.env`, `.env.local`, or files with filled-in `API_KEY` values.
- Do not `git add -f` environment files.
- Before your first push, verify:

```bash
git status
git ls-files --others --exclude-standard
```

The API uses server-side keys (`Authorization: Bearer` to OpenRouter/OpenAI). The frontend only sends a key if you typed one in the UI.

---

## Project structure

```text
app/
  api/commit-message/route.ts   # git + AI provider calls
  HomeClient.tsx                # main UI + folder modal
  page.tsx                      # SSR env defaults (no key exposure)
  layout.tsx
  globals.css
scripts/
  open-here.ps1 / .cmd / .mjs   # open app with current folder
  gitgen.cmd                    # PATH-friendly launcher
start-dev.bat                   # start server + open browser
.env.example                    # public template
LICENSE                         # non-commercial
```

---

## Stack

| Layer | Tech |
|-------|------|
| Framework | Next.js 16 (App Router) |
| UI | React 19, Tailwind CSS 4 |
| Language | TypeScript 5 |
| Runtime | Bun (Node-compatible) |
| AI | OpenRouter Chat Completions / OpenAI Responses API |

---

## License

**Free for personal use, learning, and non-commercial projects.**

You may not sell the app, parts of it, or monetize it (paid SaaS, commercial product, paid bundle, etc.) without written permission.

See [LICENSE](./LICENSE) for full terms (same spirit as the *Non-Commercial License* used in projects like WaterDrop).

Commercial licenses or exceptions: contact the author.

---

<div align="center">

**Jubarte** · 2026

<sub>Built for speed in the terminal — with commit messages that don't embarrass you.</sub>

</div>