# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

HexFF is a work-in-progress cross-platform hex editor desktop app built with **Tauri 2** (Rust backend in `src-tauri/`) and a **React 19 + TypeScript + Vite** frontend (`src/`), using Ant Design and styled-components for UI.

## Commands

Requires Node.js 26+ (`engines` in `package.json`; CI uses Node 26).

- `npm install` — install frontend deps (`dep_iu.sh` / `dep_iu.ps1` also run `cargo install --path ./src-tauri`)
- `npm run tauri dev` — run the desktop app in dev mode (starts Vite on port 1420 via `beforeDevCommand`)
- `npm run build` — type-check (`tsc`) and build the frontend into `dist/`
- `npm run tauri build` — full release build (this is what CI runs); `npm run test-release` builds without bundling installers
- `npm run lint` — Biome lint + format check + check (CI gate); `npm run lint-fix` applies fixes
- Rust: `cargo build` / `cargo clippy` / `cargo test` from the repo root (root `Cargo.toml` is a workspace with `src-tauri` as its only member). There are currently no Rust or frontend tests.

CI (`.github/workflows/main-lint-test-deploy.yml`) runs on PRs to `master`, `develop`, `release/**` on macOS/Ubuntu/Windows: `npm run lint` then `npm run tauri build`. PRs target `develop`.

## Architecture

**File access lives entirely in Rust.** The frontend never reads files directly; it calls Tauri commands registered in `src-tauri/src/lib.rs` (`generate_handler!`). All commands and their argument names are wrapped in `src/utilities/app/TauriWrappers.ts` (file ops) and `src/utilities/app/Settings.ts` (`load_settings`/`save_settings`). When adding a command, register it in `lib.rs` and add a typed wrapper there — frontend uses camelCase args (`fileIndex`), Rust receives snake_case (`file_index`).

**Backend state model** (`src-tauri/src/types.rs`): `AppState` holds a `Mutex<Vec<AppFileState>>`; each open file keeps its `std::fs::File` handle, size, `prev_seek_pos`, and a fixed **1024-byte buffer** (`bytes_at_pos`) of the most recently read window. Files are identified by their index in this vector (no close/removal yet).

- `read_file(file_index, file_pos)` seeks, fills the 1024-byte buffer, stores it, and returns it **base64-encoded**; the frontend decodes with `atob` in `HexEditViewComponent.tsx`.
- `get_data_in_position` / `get_text_data_in_position` interpret bytes from the cached buffer (offset relative to `prev_seek_pos`), not from disk — so they reflect the last `read_file` window. Numeric interpretations are in `hex_data.rs`; ASCII/UTF-8/16/32 decoding in `string_encodings.rs`.

**Settings** are persisted by `confy` (TOML, app name `hex_ff`) via `src-tauri/src/config.rs`; the `AppConfig` struct there must stay in sync with the `Settings` type in `src/utilities/app/Settings.ts`.

**Frontend layout**: `src/App.tsx` owns the open-file list and handles menu/toolbar actions (`src/menu/`); `TabbedFilesComponent` renders one tab per open file, each with `HexEditView` plus the data inspector panels (`ByteValueView`, `TextValueView`) in `src/components/app/DataInspectors/`. The window is undecorated (`decorations: false`), so `WindowTitle.tsx` draws the title bar. Theming goes through `src/context/AntdThemeContext.tsx`.

**Localization**: i18next with namespaces `ui`, `messages`, `settings` under `src/localization/{en,fi}/*.json`, registered in `src/localization/Localization.ts`. Use the `useTranslate` hook; keys are typed from the English JSON files, so add new keys to `en` (and `fi`).

**Updater**: `tauri-plugin-updater` pulls `latest.json` from GitHub releases (`src/hooks/UseTauriUpdater.tsx`, config in `src-tauri/tauri.conf.json`).

## Conventions (enforced by `biome.json`)

- TS/TSX filenames must be **PascalCase** (`useFilenamingConvention`), including hooks (`UseDebounce.ts`).
- 4-space indent, 120 line width, double quotes, LF line endings, ES5 trailing commas, arrow parens only when needed.
- Block statements required, `for...of` instead of `forEach`, `import type` for type-only imports, `===` only.

## Git workflow

Changes go to `develop` through pull requests, one branch per change:

1. Before starting, check `git status`. If the repository folder has local uncommitted changes (modified, staged or untracked files, other than agent tool folders such as `.claude/`), stop and ask the user what to do with them. Otherwise switch to `develop` and update it from `origin` (`git pull --ff-only`).
2. Create a new branch from `develop` (e.g. `feature/<short-name>` or `fix/<short-name>`).
3. Commit the changes to that branch and push it to `origin`.
4. Create a pull request into `develop` without asking for confirmation first.