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
  <a href="#cli"><strong>CLI (`gg`)</strong></a> ·
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
- Terminal CLI: `gg` / `gitgen` — short commands (`gg c p`, `gg b …`) or long forms
- `gg start` opens the app with `?path=` from any repo
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
    A["Your repo"] -->|gitgen start or modal| B["Git Command Generator"]
    B --> C{"Empty commit message?"}
    C -->|No| D["Build command block"]
    C -->|Yes + API key| E["commit-message API"]
    E -->|git status + diff| F["Local git"]
    E -->|context| G["OpenRouter or OpenAI"]
    G -->|Conventional Commit| D
    D --> H["Clipboard"]
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
| `gg start` / `gitgen start` | Same idea from PATH — see [CLI](#cli) |

---

## CLI

Run Git Command Generator from **any** project folder via **`gg`**, **`gitgen`**, or **`git-gen`**. Three equivalent launchers live in `scripts/`:

| Launcher | Notes |
|----------|--------|
| `gg` | Short name (recommended) |
| `gitgen` | Full name |
| `git-gen` | Hyphenated alias |

Bare `gg` / `gitgen` (no arguments) prints **help** — it does **not** open the app.

### Install on PATH (once)

Add the repo’s `scripts/` directory to your user `PATH`, then open a **new** terminal:

```powershell
# Windows (PowerShell) — adjust the clone path:
[Environment]::SetEnvironmentVariable(
  "Path",
  $env:Path + ";H:\Python\Slop\git-command-generator\scripts",
  "User"
)
```

Without PATH, you can still run:

```bash
bun /path/to/git-command-generator/scripts/cli.ts <cmd> [args]
```

Requires [Bun](https://bun.sh) on your `PATH`.

### Open the web app

```bash
gg start
# same as: gitgen start
```

| Server state | Behavior |
|--------------|----------|
| Already running on `localhost:2001` | Opens the browser with `?path=` for the current folder |
| Offline | Starts `bun run dev` in the background, waits, then opens the browser |

Uses `scripts/open-here.ps1` (Windows) or `open-here.mjs` under the hood.

### Workflows in the terminal

Every app card also works as a CLI command — **no browser, no server**. Commands run `git` in the current folder and reuse the same AI message generator (`lib/commit-message.ts`).

**Short commands** (recommended) and long forms both work on `gg` and `gitgen`:

```bash
gg start                   # open the web app with current folder
gg c                       # commit only
gg c p                     # commit + push
gg b feature/x             # create branch → add → commit → push -u
gg m feature/x             # merge feature/x into main
gg m feature/x dev         # merge feature/x into dev
gg s                       # commit work, then checkout main
gg sw main                 # switch branch
gg r <url>                 # init + remote + first push (main)
gg rs                      # restore all uncommitted changes (confirms)
gg rs src/x.ts             # restore one file
gg v                       # print version
gg h                       # help
```

| Short | Long | App card | What it does |
|-------|------|----------|--------------|
| `gg start` | `gitgen start` | — | Open the web app with the current folder |
| `gg c` | `gitgen commit` | 02 Commit Only | `git add .` → AI/`-m` message → `git commit` |
| `gg c p` | `gitgen commit push` | 01 Commit + Push | …then `git push` (`p` = short for `push`) |
| `gg b <name>` | `gitgen branch <name>` | 03 Create Branch | `checkout -b` → add → commit → `push -u origin <name>` |
| `gg m <src> [dst]` | `gitgen merge <src> [dst]` | 04 Merge into Main | commit → `checkout <dst or main>` → `merge <src>` → push |
| `gg s` | `gitgen save` | 05 Save & Return | commit current work → `checkout main` |
| `gg sw <branch>` | `gitgen switch <branch>` | 06 Switch Branch | `git checkout <branch>` |
| `gg r <url>` | `gitgen remote <url>` | 07 Add Remote | `git init` → `remote add origin` → first push to `main` |
| `gg rs [file]` | `gitgen restore [file]` | 08 / 09 Restore | `git restore .` (or one file) — **destructive**, confirms first |
| `gg v` | `gitgen version` | — | Print installed version (`package.json`; also `--version` / `-V`) |
| `gg h` | `gitgen help` | — | Show all commands (same as bare `gg`) |

### Versioning

The CLI version is **`package.json` → `version`** (single source of truth via `lib/version.ts`).

```bash
gitgen version          # or: gg v  ·  gitgen --version  ·  bun run version:show
```

To release (updates `package.json` and prepends `CHANGELOG.md`):

```bash
bun run version:patch   # 1.0.0 → 1.0.1
bun run version:minor   # 1.0.0 → 1.1.0
bun run version:major   # 1.0.0 → 2.0.0
# optional note:
bun scripts/bump-version.ts patch "fix restore confirm on Windows"
```

### Flags, AI messages, progress

| Flag | Applies to | Effect |
|------|------------|--------|
| `-m "msg"` / `--message` | any command that commits | Use this commit message instead of AI/default |
| `-y` / `--yes` | `restore` / `rs` | Skip the destructive confirmation prompt |

- **AI messages:** omit `-m` and, if an API key is set in `.env.local`, the message is generated from your diff (same as the app). Without a key, a sensible default is used (`feat: update`, `wip: saving progress`, …).
- **Provider env:** `AI_PROVIDER`, matching `*_API_KEY` / `*_MODEL`, and `COMMIT_LANGUAGE` from `.env.local`.
- **Live progress:** each step shows a spinner with elapsed time and `✓`/`✗`. Pushes render a real progress bar from git’s transfer stats:

```text
  ⠹ git push  [██████████████░░░░░░░░]  63% Writing objects  2.3s
  ✓ git push  4.1s
```

### CLI env vars

| Env var | Default | Purpose |
|---------|---------|---------|
| `GCG_PORT` | `2001` | Dev server port when using `gg start` |
| `GCG_TIMEOUT` | varies | How long to wait for the server to come up (seconds) |
| `GCG_TTY` | — | Set by launchers so spinners work under PowerShell/cmd |

Implementation: `scripts/cli.ts` (Bun). Launchers: `scripts/gg.cmd`, `gitgen.cmd`, `git-gen.cmd`.

---

## AI commit generation

### Setup

1. **Folder** — via `gitgen start`, the startup modal, or **Settings → Change**
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
  api/commit-message/route.ts   # HTTP wrapper around lib/commit-message
  HomeClient.tsx                # main UI + folder modal
  page.tsx                      # SSR env defaults (no key exposure)
  layout.tsx
  globals.css
lib/
  commit-message.ts             # shared git + AI generation (app + CLI)
  version.ts                    # getVersion() — reads package.json
scripts/
  cli.ts                        # CLI entry: start, workflows, version, short aliases, help
  bump-version.ts               # semver bump → package.json + CHANGELOG.md
  gg.cmd / gitgen.cmd / git-gen.cmd  # PATH launchers → cli.ts (bare = help)
  open-here.ps1 / .cmd / .mjs   # open app with cwd (?path=); used by `gg start`
  tray.ps1 / tray.vbs           # background server tray helper (Windows)
CHANGELOG.md                    # release notes (kept in sync by bump script)
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

<sub>Built for speed in the terminal — <code>gg c p</code> and commit messages that don't embarrass you.</sub>

</div>