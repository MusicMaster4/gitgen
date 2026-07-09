<div align="center">

# gitgen

### Git workflows in your terminal — AI commits included

**Type less. Commit better. Ship faster.**

`gg cnp` · add · AI Conventional Commit · push

<br />

[![npm](https://img.shields.io/npm/v/git-command-generator?style=flat-square&color=CB3837&label=npm)](https://www.npmjs.com/package/git-command-generator)
[![node](https://img.shields.io/badge/node-%3E%3D18-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![license](https://img.shields.io/badge/license-non--commercial-blue?style=flat-square)](./LICENSE)

```bash
npm install -g git-command-generator
gg setup          # one-time OpenRouter setup
gg cnp            # commit + push with AI message
```

<p>
  <a href="#install"><strong>Install</strong></a> ·
  <a href="#quick-start"><strong>Quick start</strong></a> ·
  <a href="#commands"><strong>Commands</strong></a> ·
  <a href="#flags"><strong>Flags</strong></a> ·
  <a href="#configuration"><strong>Config</strong></a> ·
  <a href="#examples"><strong>Examples</strong></a>
</p>

</div>

---

## What it does

**gitgen** (`gg`) is a terminal CLI that runs everyday Git workflows as short commands — and can write your commit message from the real `git diff` via OpenRouter.

No browser required. No accounts beyond an optional OpenRouter key. Works in any repo folder on Windows, macOS, and Linux.

| You type | What runs |
|----------|-----------|
| `gg cnp` | `git add .` → AI commit → `git push` |
| `gg b feature/login` | new branch → add → commit → `push -u` |
| `gg m feature/login` | commit work → merge into `main` → push |
| `gg s` | commit work → checkout `main` |

Messages follow [Conventional Commits](https://www.conventionalcommits.org) (`feat:`, `fix:`, `chore:`, …). Pass `-m` anytime to skip AI.

---

## Install

**Requirements:** [Node.js 18+](https://nodejs.org) and [Git](https://git-scm.com) on your `PATH`.

```bash
npm install -g git-command-generator
```

This puts three commands on your PATH (same binary):

| Command | Notes |
|---------|--------|
| **`gg`** | Short name — recommended |
| **`gitgen`** | Full name |
| **`git-gen`** | Alias |

Verify:

```bash
gg version
# or: gitgen version · gg v · gitgen --version
```

You should see the version, install path, and config path.

### Update

```bash
gg update
# or: npm update -g git-command-generator
```

### Uninstall

```bash
npm uninstall -g git-command-generator
```

---

## Quick start

```bash
# 1. Install
npm install -g git-command-generator

# 2. One-time AI setup (API key is hidden as you type)
gg setup

# 3. In any git repo
cd your-project
gg cnp                 # stage everything, AI commit message, push
```

Without an API key, commits still work — they use sensible defaults (`feat: update`, `wip: saving progress`, …). Run `gg setup` when you want AI-written messages.

Bare `gg` / `gitgen` prints **help**. It does not open a browser.

---

## Commands

All of these work with **`gg`**, **`gitgen`**, or **`git-gen`**.

### Workflows

| Short | Long | Description |
|-------|------|-------------|
| `gg c` | `gg commit` | Stage all → commit (no push) |
| `gg c p` | `gg commit push` | Stage all → commit → push |
| `gg cnp` | `gg commit-and-push` | Same as commit + push (one token) |
| `gg b <name>` | `gg branch <name>` | Create branch → add → commit → `push -u origin <name>` |
| `gg m <src> [dst]` | `gg merge <src> [dst]` | Commit → checkout `dst` (default `main`) → merge `src` → push |
| `gg s` | `gg save` | Commit current work → checkout `main` |
| `gg sw <branch>` | `gg switch <branch>` | Checkout a branch |
| `gg r <url>` | `gg remote <url>` | `git init` → add `origin` → first push to `main` |
| `gg rs` | `gg restore` | Discard **all** uncommitted changes (asks first) |
| `gg rs <file>` | `gg restore <file>` | Discard changes to one file |

### Setup & tooling

| Short | Long | Description |
|-------|------|-------------|
| `gg setup` | `gg setup` / `gg onboard` | Interactive OpenRouter onboard (key, model, language) |
| `gg config` | `gg config` | Show config (key masked, model, language) |
| `gg config set …` | same | Set `model`, `key`, or `language` |
| `gg config path` | same | Print config file path |
| `gg config reset` | same | Re-run full onboard |
| `gg mo [slug]` | `gg model [slug]` | Show or switch AI model |
| `gg u` | `gg update` | Check npm and install latest |
| `gg v` | `gg version` | Version + install + config paths |
| `gg h` | `gg help` | Command list (also bare `gg`) |
| `gg start` | `gg start` | Open the optional web UI for this folder |

---

## Flags

| Flag | Commands | Effect |
|------|----------|--------|
| `-m "msg"` / `--message "msg"` | Any command that commits | Use this message instead of AI / default |
| `-y` / `--yes` | `restore` / `rs` | Skip the destructive confirmation |
| `-v` / `-V` / `--version` | — | Same as `version` |
| `-h` / `--help` | — | Same as `help` |

```bash
gg c -m "fix: handle null user"
gg cnp -m "feat: add search filters"
gg rs -y
gg rs src/app.ts -y
```

---

## Configuration

### First-time setup

```bash
gg setup
```

Prompts for:

1. **OpenRouter API key** (hidden input — never echoed)
2. **Model** (default: `google/gemini-2.0-flash-001`)
3. **Language** for commit messages (`en` or `pt`)

Get a free/paid key at [openrouter.ai](https://openrouter.ai).

### Show & edit

```bash
gg config                          # show (key is masked)
gg config set model google/gemini-2.0-flash-001
gg config set language pt
gg config set key sk-or-v1-…
gg model                           # show current model
gg mo anthropic/claude-3.5-sonnet  # switch model
gg config reset                    # full re-onboard
```

### Where config lives

| OS | Path |
|----|------|
| Windows | `%APPDATA%\gitgen\config.json` |
| macOS | `~/Library/Application Support/gitgen/config.json` |
| Linux | `~/.config/gitgen/config.json` |

Permissions are owner-only where supported. The key stays on your machine and is only sent to OpenRouter when generating a message.

### Environment overrides (optional)

| Variable | Purpose |
|----------|---------|
| `OPENROUTER_API_KEY` | API key (overrides file) |
| `OPENROUTER_MODEL` | Model slug |
| `COMMIT_LANGUAGE` | `en` or `pt` |
| `GITGEN_CONFIG_DIR` | Custom config directory |
| `GCG_PORT` | Web UI port for `gg start` (default `2001`) |

---

## Examples

```bash
# Everyday commit + push
gg cnp

# Commit only (stay local)
gg c

# Explicit message (no AI)
gg c p -m "chore: bump dependencies"

# Feature branch end-to-end
gg b feature/checkout
# …work…
gg cnp
gg m feature/checkout          # merge into main and push

# Merge into a non-main branch
gg m feature/checkout develop

# Park work and jump back to main
gg s

# Switch branches
gg sw develop

# Brand-new repo → GitHub
gg r https://github.com/you/new-repo.git

# Undo uncommitted mess (confirm required unless -y)
gg rs
gg rs package-lock.json
```

### Live progress

Each step prints a compact status line (spinner, checkmark, timing). Pushes show a small transfer bar only while objects are counting/writing:

```text
  ⠹ git push [████████░░░░░░]  63% Writing  2.3s
  ✓ git push  4.1s
```

---

## How AI commits work

When you omit `-m` and a key is configured:

1. CLI runs `git status` / name-status / diff in **your current folder**
2. A compact summary is sent to OpenRouter
3. The model returns a short Conventional Commit subject
4. That message is used for `git commit`

| Situation | Result |
|-----------|--------|
| Key set, no `-m` | AI message from local diff |
| `-m "…"` passed | Your message, no API call |
| No key | Default message (`feat: update`, etc.) |
| Clean working tree | Nothing to commit — exits cleanly |

First AI use without a key launches the setup wizard automatically.

---

## Optional web UI

The package is **CLI-first**. There is also a local Next.js UI if you clone the full repo.

```bash
git clone https://github.com/MusicMaster4/git-command-generator.git
cd git-command-generator
npm install
npm run dev          # http://localhost:2001
```

From a full checkout (not the slim npm install), `gg start` can open the app with the current folder as `?path=`. From a global npm install, `gg start` opens the browser only if the server is already running on port `2001`.

| Script | Purpose |
|--------|---------|
| `npm run dev` | Dev server on port **2001** |
| `npm run build` | Production web build |
| `npm run build:cli` | Bundle CLI → `dist/cli.js` |
| `npm test` | Unit tests |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |

---

## Security

- API keys live in a **user config file** or env vars — never in the repo
- Key input in `gg setup` is **hidden** (not echoed)
- Config file mode is restricted to the owner when the OS allows it
- Diffs leave your machine only when you generate an AI commit (OpenRouter)

Treat keys like passwords. Do not commit `.env.local` or filled-in secrets.

---

## License

**Free for personal use, learning, and non-commercial projects.**

Commercial use, resale, or paid hosting requires written permission.

See [LICENSE](./LICENSE) for full terms.

---

<div align="center">

**Jubarte** · 2026

<sub><code>gg cnp</code> — commit messages that don't embarrass you.</sub>

</div>
