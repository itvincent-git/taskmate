# Markdown editor validation — 2026-09-09

## Implementation

- CodeMirror owns the live immutable `Text` document. The workspace holds a document reference and monotonically increasing draft version, serializing at save boundaries. Ordinary save acknowledgements never replace the editor document; file identity and an explicit external replacement revision control replacement.
- Saving acknowledges its captured version. Edits during the request remain dirty, queued requests read the latest document, and failed saves retain both the draft and its tab. Manual save, task creation/switching and tab closing flush the current draft. Autosave remains 650ms after the last edit.
- Layout-changing preview replacements are direct state decorations, independent of the viewport. There are no hidden editor lines. Selection changes update the departing/entering blocks and reuse the parsed index; scrolling reuses the same decoration set.
- Plain prose edits map the existing index and decorations and update only the affected paragraph source. Potential Markdown structure/dependency changes conservatively invalidate the index. The existing 75ms preview refresh delay is unchanged. Parser completion runs in 10ms background slices; full syntax completion is requested synchronously only for explicit fragment navigation.
- Composition preserves the current DOM until composition end. Task and footnote actions resolve current positions. Math rendering has a bounded content cache; Mermaid widgets retain their rendered DOM across viewport removal and ignore results for detached nodes.
- Virtual task rows isolate layout and keep stable card subtrees while scrolling. Expensive quick-edit controls mount only after a 150ms stationary hover, so cards passing beneath the pointer do not create dropdown and popover trees.

## Browser reproduction

The existing server on port 5273 was verified to be a child of `pnpm tauri dev`, with a running native Taskmate process. A second attempted Tauri startup correctly failed on the occupied port; testing reused the existing server. Browser testing used a disposable demo workspace, `/tmp/taskmate-editor-regression`, not native user files.

The baseline page loaded the three editor/workspace files from baseline commit `2bab4df` through an ignored `.playwright-cli` fixture. This froze the original implementation while the fix was developed. Runs interrupted by Vite hot reload were discarded.

`editor-input-benchmark.js` sends 900 real browser keyboard events over 30 seconds: repeated letters, Enter, and sustained Backspace, starting with three plain lines. The editor was 512px wide (472px of text space), so the growing lines also crossed visual wrapping boundaries. It records keydown-to-next-animation-frame latency, long tasks, editor transactions, full-document replacements, and exact document/persisted-content equality. It does not substitute synchronous dispatch timing for input latency.

| Measurement | Original preview | Fixed preview (quiet run) |
| --- | ---: | ---: |
| Keyboard events / target rate | 900 / 30 per second | 900 / 30 per second |
| Elapsed | 30,162ms | 30,002ms |
| P95 to next animation frame | 13.5ms | 5.1ms |
| Longest page task | 460ms | 96ms |
| Full-document replacements | 36 | 0 |
| Document transactions | 936 | 900 |
| Final characters / expected | 19 / 553 | 553 / 553 |
| Exact persisted content | Failed | Passed |

The old P95 alone masked data loss. The fixed quiet run had no editor dispatch above 20ms and no page task above 100ms. An earlier fixed run recorded a single 111ms page task despite all editor dispatches staying below 20ms; these are development-browser observations, not a hardware-independent guarantee.

Source mode also completed 900 events in 30,001ms with exact document/persisted content, zero replacements and P95 12.7ms (maximum input frame 94.4ms). Its save/refresh after the typing period recorded a 292ms page task; no editor dispatch exceeded 20ms.

The scroll benchmark uses 39,570 characters / 4,501 lines, with 300 groups of headings, multiline paragraphs, task checkboxes, tables and display math. Across 60 viewport jumps the decoration set retained object identity, document content remained exact, hidden editor lines stayed at zero, and there were no recorded long tasks (50ms threshold).

A separate 1,000-task browser fixture reproduced the task-list stall. Before the task-card change, 10 viewport jumps took 3,147ms. After deferring quick editors and isolating virtual rows, a 60-step continuous scroll with the pointer over the list had a 23.5ms P95 frame, a 24.8ms maximum frame, no frames above 32ms, and mounted no hidden quick editors.

Run against an open disposable browser-demo task:

```sh
pnpm tauri dev
playwright-cli open http://localhost:5273
playwright-cli run-code --filename scripts/editor-input-benchmark.js
playwright-cli eval 'window.editorBenchmark'
playwright-cli run-code --filename scripts/editor-scroll-benchmark.js
playwright-cli eval 'window.editorScrollBenchmark'
```

These scripts intentionally replace the selected demo task's body. Do not run them against a document you want to retain.

## Automated regression coverage

The tests cover document ownership and explicit replacement, preview/source mode history, shortcuts, search/replace, task checkboxes after mapped edits, footnote navigation, composition DOM stability, all existing rich Markdown previews, autosave during sustained editing, input during slow saving, manual saving, failed save/retry, immediate task changes, close during saving and external-check races/reload.

- Frontend: 273 tests across 26 files passed (`VITEST_MAX_FORKS=1 VITEST_MIN_FORKS=1 pnpm test`). A first parallel run exceeded an existing 5-second application-test timeout; the full suite passed with one worker.
- Release scripts: 2 tests passed (`node --test scripts/version.test.mjs`).
- Native Rust: 30 tests passed (`cargo test --manifest-path src-tauri/Cargo.toml`).
- TypeScript typecheck and production Vite build passed. Vite retains its large-chunk advisory for editor/Mermaid bundles.

## Remaining native acceptance

The actual Tauri process was running, but macOS rejected UI automation with `osascript is not allowed assistive access (-1719)`. Consequently, real WebView keyboard/Chinese IME acceptance has **not** been completed. Synthetic composition regression and browser keyboard results do not establish native IME correctness. The plan's native acceptance requirement must be checked before its final commit gate is considered satisfied.
