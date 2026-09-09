// Run in a disposable browser-demo task after pnpm tauri dev.
// playwright-cli run-code --filename scripts/editor-scroll-benchmark.js
// playwright-cli eval 'window.editorScrollBenchmark'
async (page) => {
  const source = Array.from({ length: 300 }, (_, index) =>
    `## Section ${index}\n\nFirst soft line\nsecond soft line\n\n- [ ] task ${index}\n\n| Item | State |\n| --- | --- |\n| entry | ready |\n\n$$\nx^2 + ${index}\n$$\n\n`
  ).join("");
  await page.evaluate(async source => {
    const { EditorView } = await import("/node_modules/.vite/deps/@codemirror_view.js");
    const view = EditorView.findFromDOM(document.querySelector(".cm-editor"));
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: source }, selection: { anchor: 0 } });
    window.scrollBenchmarkView = view;
    window.scrollBenchmarkEditorView = EditorView;
  }, source);
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    const view = window.scrollBenchmarkView;
    window.scrollBenchmarkDecorations = view.state.facet(window.scrollBenchmarkEditorView.decorations)[0];
    window.editorScrollBenchmark = { longTasks: [] };
    window.scrollBenchmarkObserver = new PerformanceObserver(list => window.editorScrollBenchmark.longTasks.push(...list.getEntries().map(e => e.duration)));
    window.scrollBenchmarkObserver.observe({ type: "longtask" });
  });
  for (let index = 0; index < 60; index++) {
    await page.evaluate(index => {
      const scroller = document.querySelector(".cm-scroller");
      scroller.scrollTop = (index % 20) / 19 * scroller.scrollHeight;
    }, index);
    await page.waitForTimeout(50);
  }
  await page.evaluate(source => {
    window.scrollBenchmarkObserver.disconnect();
    const view = window.scrollBenchmarkView;
    const result = window.editorScrollBenchmark;
    result.reusedDecorations = view.state.facet(window.scrollBenchmarkEditorView.decorations)[0] === window.scrollBenchmarkDecorations;
    result.matches = view.state.doc.toString() === source;
    result.characters = source.length;
    result.lines = view.state.doc.lines;
    result.hiddenLines = document.querySelectorAll(".cm-line.hidden").length;
    result.maxLongTask = Math.max(0, ...result.longTasks);
  }, source);
}
