# Changelog

## 1.0.10 — 2026-07-10

- Automated release from main.

## 1.0.9 — 2026-07-10

- Automated release from main.

## 1.0.8 — 2026-07-10

- Automated release from main.

## Unreleased

- **PR workflow:** `gg pr [base]` and `gg cnp pr [base]` — push the current branch, generate an AI title + description from the branch diff, and create a GitHub pull request via `gh`. Prompts for the merge target (base) branch; `-y` skips confirm and uses the default base.
- **PR AI:** title and body are two separate plain-text model calls (no JSON), which is more reliable on smaller models.
- **PR reuse:** if the head branch already has an open PR, push only and print that URL (skip AI create).
- **CLI UX:** `cnp pr` prints a single `done` after the full flow (no early done after commit).

## 1.0.6 — 2026-07-09

- Automated release from main.

## 1.0.5 — 2026-07-09

- Automated release from main.

## 1.0.4 — 2026-07-09

- Automated release from main.

## 1.0.3 — 2026-07-09

- Automated release from main.

## 1.0.2 — 2026-07-09

- Automated release from main.

## 1.0.1 — 2026-07-09

- Automated release from main.

All notable changes to Git Command Generator are documented here.
Version numbers match `package.json` (semver). Bump with:

```bash
npm run version:patch   # 1.0.0 → 1.0.1
npm run version:minor   # 1.0.0 → 1.1.0
npm run version:major   # 1.0.0 → 2.0.0
```

CLI: `gitgen version` / `gg v` / `gitgen --version`.

## 1.0.0 — 2026-07-09

- Initial release with web app and CLI workflows (commit, branch, merge, save, switch, remote, restore).
- CLI version command and semver bump tooling (`lib/version.ts`, `scripts/bump-version.ts`).
- npm-installable Node CLI (`gitgen` / `gg` bins), OpenRouter user config + setup, `gitgen update`, and auto-release workflow on `main`.
