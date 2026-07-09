# Changelog

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
