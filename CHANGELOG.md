# Changelog

All notable changes to HexFF are documented here. The project follows [Semantic Versioning](https://semver.org/):
while the major version is 0 the app is a work in progress, new features raise the minor version and fixes,
refactoring and maintenance raise the patch version.

The versions before 0.8.1 were assigned afterwards from the git history; they were never released or tagged.

## [0.8.1] - 2026-11-25

### Added
- Unit tests for the Rust backend and the TypeScript frontend.
- Local CI scripts (`local-ci.ps1`, `local-ci.sh`); the GitHub workflow runs manually only.
- Semantic versioning: `package.json` is the single source of the version, `npm version` keeps the Rust crate in sync.

### Changed
- New HexFF hexagon app icon.
- About popup: the Tauri logo opens tauri.app, the app icon sits beside the version and license texts.
- Styled components are declared with `let` and reassigned; a Biome plugin enforces the pattern.
- Removed leftover ESLint suppressions, fixed the `updateBackground` name and a render-scoped key counter.

## [0.8.0] - 2026-11-25

### Added
- Recent files list, opening files from the command line and the OS, drag and drop.

## [0.7.0] - 2026-11-25

### Added
- Search for hex (with wildcards), text and numbers, with progress and cancel.

## [0.6.0] - 2026-11-25

### Added
- Saving, unsaved-changes prompts and detection of changes made by other programs.

## [0.5.0] - 2026-11-25

### Added
- Editing with a piece table, undo/redo and insert/overwrite modes.

## [0.4.0] - 2026-11-25

### Added
- Virtualized read-only hex view with cursor, selection and Go to offset.

## [0.3.0] - 2026-11-25

### Changed
- Dependencies upgraded to their latest versions, Node.js 26 required.
- File access moved to a Rust document store with raw byte reads; inspector fixes; Rust CI checks.

## [0.2.2] - 2025-03-08

### Changed
- Removed unused dependencies and updated the rest.

## [0.2.1] - 2024-12-09

### Changed
- Replaced ESLint and Prettier with Biome; dependency updates.

## [0.2.0] - 2024-10-12

### Changed
- Moved to Tauri 2.

## [0.1.0] - 2024-08-05

### Added
- Proof of concept hex editor: hex data view with scrolling, value viewer, character view in different encodings,
  dark mode, keyboard and mouse wheel interaction.
