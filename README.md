# Taskmate

Taskmate is a local-first desktop task manager built with Tauri 2, React, TypeScript, CodeMirror 6, Lezer Markdown, Rust, and SQLite.

Every task is an independent Markdown file. YAML frontmatter holds task metadata and extensible properties; the Markdown body is the editor’s only content state. SQLite is a disposable query index and can be rebuilt from the files at any time.

## Workspace format

```text
workspace/
├── tasks/                 # active task Markdown files and nested folders
├── archive/               # archived task Markdown files and independent folders
├── attachments/
├── .task-app/
│   ├── properties.json    # workspace property schema
│   ├── index.sqlite       # rebuildable and Git-ignored
│   └── backups/
└── .git/
```

Task folders are real directories under `tasks/` and `archive/`. The directory is the only source of membership; Markdown frontmatter has no folder field. Task UUIDs remain stable and the API exposes `folderPath` relative to the region root alongside the basename `fileName`. Existing files and older frontend caches default to the root directory. SQLite is a disposable, rebuildable index.

The folder navigator includes empty folders and supports nested creation, rename, move, and empty-folder deletion. Selecting a parent includes its descendants; “Root tasks” includes only files directly in the region root. New tasks use the selected active folder (or the root from “All tasks”). Archive and restore retain the current relative directory, creating missing parents. Active and archive trees are independent.

Checkboxes, Cmd/Ctrl-click, and Shift-click select tasks independently of the editor. Use “Move to” or drag a task, selected group, or folder to a directory. Moves stay within a region, preserve content and ordering, and stop if saving fails or an external conflict remains unresolved. Batch failures report completed and remaining counts and refresh actual disk state. Folder name collisions are rejected; task filename collisions receive a UUID suffix and, if necessary, a sequence number. Symlinks and traversal paths are rejected for folder operations. Empty folders are local filesystem entries without Git placeholder files.

A task is human-readable outside Taskmate:

```markdown
---
id: 65c16472-8ca8-40aa-bff1-1519948230f8
title: Release Taskmate
archived: false
createdAt: 2026-07-26T10:00:00+08:00
updatedAt: 2026-07-26T12:00:00+08:00
status: in-progress
priority: high
tags:
  - Tauri
  - Markdown
endDate: 2026-07-31
---

# Release checklist

- [ ] Run the full test suite
```

Unknown frontmatter values are preserved on read/write. The stable UUID, rather than the title-derived filename, identifies the task.

## Architecture

- `src-tauri/src/workspace.rs` owns directory creation, atomic save/rename, archive/delete lifecycle, incremental file scans, and index rebuilds.
- `src-tauri/src/markdown.rs` parses and serializes YAML frontmatter without dropping extension values.
- `src-tauri/src/index.rs` stores searchable task projections and applies dynamic property filters and type-aware sorts.
- `src-tauri/src/git.rs` performs guarded Git operations. Authentication is delegated to the operating system Git credential manager; embedded credentials in remote URLs are rejected.
- `src/lib/api.ts` is the typed Tauri command boundary and includes a browser-only local demo adapter for UI development.
- `src/editor/` contains Markdown toolbar commands and Lezer-tree-driven CodeMirror decorations.

Live Preview is a single CodeMirror editing surface. Decorations hide safe markers only when their parsed syntax node is inactive. Moving a cursor or selection into the node reveals the original source without changing the document.

## Development

Requirements: Node.js 24, pnpm 11, stable Rust, and the Tauri 2 platform prerequisites.

```sh
pnpm install
pnpm dev:app
```

Browser-only UI development is available with `pnpm dev`. It uses a localStorage-backed demo workspace because browsers cannot access the Rust filesystem commands.

## Releases and updates

Taskmate publishes signed macOS (Intel and Apple Silicon) and Windows x64 installers from tags named `app-v<version>`. The updater reads the public manifest at `releases/latest/download/latest.json`.

The updater private key is deliberately excluded from Git at `.tauri-signing/taskmate.key`. Before the first release, store its exact contents in the repository's `TAURI_SIGNING_PRIVATE_KEY` GitHub Actions secret and keep an offline backup. Losing that key prevents installed clients from accepting future updates.

For a new version, run `pnpm release <patch|minor|major|x.y.z>`, then push the resulting commit and annotated tag. The release command records commit subjects since the previous app tag in `changelog.json`; the GitHub workflow publishes those notes to both the GitHub release and `latest.json` before publishing the signed updater artifacts. macOS is ad-hoc signed for internal distribution, so Gatekeeper may require user confirmation; Windows SmartScreen may do the same.

## Verification

```sh
pnpm test
pnpm typecheck
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
```

The Rust tests cover frontmatter round trips and unknown values, atomic lifecycle behavior, safe filenames, archive/delete rules, index rebuild, numeric sorting, compound filters, and basic Git status. Frontend tests cover typed property controls, dynamic settings/filters, toolbar commands, Live Preview activation, and autosave state.
