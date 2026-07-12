# Changelog

## 1.0.13 — 2026-07-11

- Automated release from main.

## 1.0.12 — 2026-07-11

- Automated release from main.

## 1.0.11 — 2026-07-10

- Automated release from main.

## 1.0.10 — 2026-07-10

- Automated release from main.

## 1.0.9 — 2026-07-10

- Automated release from main.

## 1.0.8 — 2026-07-10

- Automated release from main.

## Unreleased

- **New — `gg status` (`st`):** compact status — branch, upstream ahead/behind, and staged/unstaged/untracked/conflicted counts with a file list.
- **New — `gg log [n]` (`lg`):** pretty recent-commit log (hash, relative date, author, subject; default 10, max 100).
- **New — `gg undo`:** un-commit the last commit and keep the changes staged (`reset --soft HEAD~1`), with a confirm (`-y` skips) and a warning when the commit is already on the remote.
- **New — `gg stash [pop|list]`:** park work-in-progress including untracked files (`stash push -u`, optional `-m "label"`), restore with `pop`, inspect with `list`.
- **New — `gg amend [-m]`:** stage everything and amend the last commit, keeping the message (or replacing it with `-m`); warns when the commit was already pushed.
- **Fix — `gg pull`:** the long form now runs a git pull (same as `pl`); previously it opened the PR flow. `pr` / `pull-request` still create PRs.
- **Fix — `gg restore`:** now discards staged changes too (`git restore --staged --worktree`), matching the documented "ALL uncommitted changes".
- **Improvement — auto upstream:** `gg c p`, `gg cnp`, and `gg m` now push with `-u origin <branch>` automatically when the branch has no upstream (no more failed first push).
- **Improvement — faster doctor:** independent checks (git, gh, repo, OpenRouter, …) run in parallel.
- **Improvement — help:** command list grouped into Workflows · Inspect & fix · Setup & tooling sections.
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
