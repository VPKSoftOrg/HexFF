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
- `npm test` — run the frontend unit tests once (Vitest, `*.test.ts` next to the code they test); `npx vitest` watches
- `npm run lint` — Biome lint + format check + check (CI gate); `npm run lint-fix` applies fixes
- Rust: `cargo build` / `cargo test` / `cargo clippy --all-targets -- -D warnings` / `cargo fmt --all` from the repo root (root `Cargo.toml` is a workspace with `src-tauri` as its only member). Run a single test with `cargo test <name>`, e.g. `cargo test inspect::tests::text_utf8`. Compiling the crate needs `dist/` to exist (`npm run build` first). Rust tests sit in a `#[cfg(test)] mod tests` at the end of each module; tests of JSON shapes (`serde_json::to_value`) guard the contract with the TypeScript types in `TauriWrappers.ts` and `Settings.ts`.

CI (`.github/workflows/main-lint-test-deploy.yml`) is **manual only** (`workflow_dispatch`, to save CI minutes); it runs on macOS/Ubuntu/Windows: `npm run lint`, `npm test`, `cargo fmt --check`, `npm run tauri build`, then clippy with `-D warnings` and `cargo test`. PRs target `develop`.

**Run the CI checks locally before every commit/PR** with `.\local-ci.ps1` (Windows) or `./local-ci.sh`. They stop at the first failure and run, in order:

1. `npm install`
2. `npm run lint`
3. `npm test`
4. `cargo fmt --all -- --check`
5. `npm run build` (with `-Full` / `--full`: `npm run tauri build`, the installer build CI does)
6. `cargo clippy --all-targets -- -D warnings`
7. `cargo test`

All steps must pass before pushing. If a step fails, fix it (`npm run lint-fix`, `cargo fmt --all`) and rerun.

## Architecture

**File access lives entirely in Rust.** The frontend never reads files directly; it calls Tauri commands registered in `src-tauri/src/lib.rs` (`generate_handler!`). All commands are wrapped in `src/utilities/app/TauriWrappers.ts` (documents) and `src/utilities/app/Settings.ts` (`load_settings`/`save_settings`). When adding a command, register it in `lib.rs` and add a typed wrapper there — frontend uses camelCase args, Rust receives snake_case.

**Documents** (`src-tauri/src/documents.rs`): `DocumentStore` (Tauri managed state) maps a `DocumentId` (a `u64` that is never reused) to an entry holding the document's `DocumentInfo`, its canonical path (opening the same file twice returns the existing document) and an `Arc<Mutex<Document>>`. The map lock is only held for lookups; file I/O runs under the single document's lock inside `spawn_blocking` (`run_blocking` in `lib.rs`), so a slow read never blocks other documents. Commands: `open_file`, `close_file`, `get_open_files`, `read_range`, `inspect_data`, `inspect_text`, `edit_document`, `undo_edit`, `redo_edit`, `save_file`, `save_file_as`, `check_file_changed`, `reload_file`, `search_document`, `cancel_search`, `take_pending_open_files`, `get_recent_files`, `remove_recent_file`, `clear_recent_files`. Commands that change a document go through `change_document` in `lib.rs`, which also refreshes the store's cached `DocumentInfo` (size, modified, can_undo/can_redo). Errors are returned as `Result<_, String>`; don't `unwrap()` on I/O in commands.

**Editing** (`piece_table.rs`, `history.rs`): the file is opened read-only and never changed by edits. A `PieceTable` describes the edited content as pieces pointing into the original file or an append-only buffer of added bytes. Every edit is `replace(offset, remove_len, pieces)` (overwrite, insert and delete are all replacements), which returns the removed pieces; `History` stores removed/inserted pieces per `Change`, so undo/redo never copies file data. Changes are grouped into steps (`continue_step` joins the previous step, used for consecutive keystrokes); `saved_id` tracks the saved state for the modified flag. `piece_table.rs` has a randomized test against a `Vec<u8>` model; keep it passing when changing the table.

**Saving** (`Document::write_to`): content is streamed in chunks to a temp file in the target's directory, flushed, then renamed over the target, so a failed save never leaves a partial file. On Windows a file can't be replaced while open, so the document's own handle is closed just before the rename (and reopened if the rename fails). After a save the document reopens the new file and starts a new history (old undo steps point into the replaced file), and `generation` increases so views reload. Each document keeps a `FileStamp` (size + modified time): `changed_on_disk` compares it with the path (another program changed or replaced the file → ask before overwriting), `original_intact` compares it through the open handle (the file was rewritten in place → the unedited parts now read as the other program's bytes, so saving is refused and the user must reload). Save results reach the frontend as `SaveOutcome` (`saved` / `changedOnDisk` / `changedInPlace`).

**Search** (`src-tauri/src/search.rs`): a `SearchQuery` (hex with `?` nibble wildcards, text in an encoding with optional ASCII case folding, or a typed number) becomes a `Pattern` of per-byte `ByteMatcher`s. `search()` reads 1 MiB chunks overlapping by pattern length − 1 through a callback, so `search_document` locks the document only per chunk; all-exact patterns use `memchr::memmem` (restarting one byte after each match so overlapping matches are found). Searches are cancelled through `SearchRegistry` flags keyed by a frontend-chosen search id, and report throttled `search-progress` events. In the UI, `SearchPanel.tsx` (a tab beside the inspectors, kept mounted) runs next/previous with wrap-around and "find all" (capped at `MAX_SEARCH_RESULTS`); matches are highlighted via the grid's `highlights` set. Results are dropped when the query or the content changes.

**Recent files and opening from the OS** (`recent.rs`, `launch.rs`): the recent list (last 10, newest first, deduplicated by canonical path) lives in its own `recent-files.json` next to the settings file, not in `AppConfig`, because saving preferences writes the whole settings object. The backend adds to it in `open_file` and a successful `save_file_as`. Files from the command line (also "Open with"), a second launch (`tauri-plugin-single-instance`, registered first) and macOS `RunEvent::Opened` are queued in `PendingOpens` and announced with the `open-files-requested` event; the frontend takes them with `take_pending_open_files` on mount and on each event, so files given at startup aren't lost. Dropped files arrive through the webview's drag-drop event. No file associations are registered in the bundle config.

**App-level flows** (`App.tsx`, `src/hooks/UseDocumentPrompts.tsx`): Save / Save As, the "Save changes?" prompt before closing a tab or the window (title bar, Exit, and OS closes via `onCloseRequested`), and an outside-change check on window focus that offers to reload. Async flows read the latest open files from refs. Remove a tab from state before closing its backend document, so the view stops reading it.

- `read_range(id, offset, length)` returns raw bytes via `tauri::ipc::Response` (an `ArrayBuffer` in the frontend, wrapped as `Uint8Array`); results are shorter at end of file and capped at `MAX_READ_LENGTH`.
- `src-tauri/src/inspect.rs` holds the pure decoding functions used by the inspectors. Data inspector values are `Option` (`null` in TS) when fewer bytes remain than the type needs. Text inspector output is one cell per byte: a character sits in the cell of its first byte and continuation cells are empty. UTF-8 has no byte order.

**Settings** are persisted by `confy` (TOML, app name `hex_ff`) via `src-tauri/src/config.rs` (`load_from`/`store_to` take the path, so tests use a temp dir); the `AppConfig` struct there must stay in sync with the `Settings` type in `src/utilities/app/Settings.ts`.

**Frontend tests** use Vitest in a Node environment (no DOM): pure modules such as `HexNavigation.ts` are tested directly, and Tauri calls are tested by mocking `@tauri-apps/api/core` / `event` with `vi.mock` (see `TauriWrappers.test.ts`). Test files must follow the PascalCase filename rule too.

**Frontend layout**: `src/App.tsx` owns the open-file list and active file, and handles menu/toolbar actions (`src/menu/`). Actions aimed at the active file (e.g. Go to offset) are sent as a `HexViewCommand` with an increasing `seq`, which the active `HexView` reacts to. `TabbedFilesComponent` renders one tab per open file; inactive tabs stay mounted, so each view keeps its own cursor and scroll position. The window is undecorated (`decorations: false`), so `WindowTitle.tsx` draws the title bar. Theming goes through `src/context/AntdThemeContext.tsx`; the hex grid gets its colors from antd tokens as CSS variables.

**Hex view** (`src/components/app/HexView/`): `HexView.tsx` is the per-file view (keyboard handling, wheel and slider scrolling, data loading, inspectors, status bar, Go to offset dialog). `HexGrid.tsx` draws only the visible rows (offset, 16 hex cells, ASCII) as plain elements; the row count comes from measuring the grid area, so rows must stay exactly `ROW_HEIGHT` px. Scrolling is by row index (`topRow`) with a slider instead of a native scrollbar, so file size isn't limited by the browser's maximum element height. Cursor, selection and navigation rules are pure functions in `HexNavigation.ts`. Data reads use "latest request wins" so fast scrolling never shows stale bytes. Key handling is on the focusable grid element, not on `window`. The cursor can sit on the append position (`offset == size`), drawn as an empty cell, so bytes can be added at the end or to an empty file.

**Editing in the view**: every key action, mouse click and menu command runs through a promise queue (`enqueue` in `HexView.tsx`) and reads the latest cursor/size/mode from refs, so fast typing can't reorder edits or act on stale state. Hex digits are typed a nibble at a time (`nibbleRef`); consecutive keystrokes pass `continueStep` so they undo together, and any other action ends the step (`endTyping`). After an edit the view bumps `version` to reload data and reports the new `DocumentInfo` through `onDocumentChange`, which updates the tab (a `●` marks unsaved changes). Paste is not implemented yet. The data/text inspector panels are in `src/components/app/DataInspectors/`.

**antd menus**: keep menu item labels inline. A block or flex element inside a menu item label wraps below the icon and is clipped (see `withShortcut` in `src/menu/MenuItems.tsx`).

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