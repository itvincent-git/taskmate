# Taskmate

Taskmate is a local-first desktop task manager built with Tauri 2, React, TypeScript, CodeMirror 6, Lezer Markdown, Rust, and SQLite.

Every task is an independent Markdown file. YAML frontmatter holds task metadata and extensible properties; the Markdown body is the editor’s only content state. SQLite is a disposable query index and can be rebuilt from the files at any time.

## Workspace format

```text
workspace/
├── tasks/                 # active task Markdown files
├── archive/               # archived task Markdown files
├── attachments/
├── .task-app/
│   ├── properties.json    # workspace property schema
│   ├── index.sqlite       # rebuildable and Git-ignored
│   └── backups/
└── .git/
```

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

Live Preview is a single CodeMirror editing surface. Decorations hide safe markers only when their parsed syntax node is inactive. Moving a cursor or selection into the node, or starting IME composition, reveals the original source without changing the document.

## Development

Requirements: Node.js 24, pnpm 11, stable Rust, and the Tauri 2 platform prerequisites.

```sh
pnpm install
pnpm dev:app
```

Browser-only UI development is available with `pnpm dev`. It uses a localStorage-backed demo workspace because browsers cannot access the Rust filesystem commands.

## Verification

```sh
pnpm test
pnpm typecheck
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
```

The Rust tests cover frontmatter round trips and unknown values, atomic lifecycle behavior, safe filenames, archive/delete rules, index rebuild, numeric sorting, compound filters, and basic Git status. Frontend tests cover typed property controls, dynamic settings/filters, toolbar commands, Live Preview activation, and autosave state.
