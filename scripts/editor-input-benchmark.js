// Run after opening a disposable browser-demo task through the Tauri dev server:
// playwright-cli run-code --filename scripts/editor-input-benchmark.js
// playwright-cli eval 'window.editorBenchmark'
async (page) => {
  const content = page.locator(".cm-content");
  const initial = "first line\nsecond line\nthird line";
  await content.fill(initial);
  await content.press("ControlOrMeta+End");
  await page.waitForTimeout(1000);
  await page.evaluate(async () => {
    const { EditorView } = await import("/node_modules/.vite/deps/@codemirror_view.js");
    const { StateEffect, Compartment } = await import("/node_modules/.vite/deps/@codemirror_state.js");
    const view = EditorView.findFromDOM(document.querySelector(".cm-editor"));
    window.benchmarkView = view;
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    window.editorBenchmark = { frames: [], longTasks: [], replacements: 0, transactions: 0 };
    const result = window.editorBenchmark;
    result.dispatches = [];
    const dispatch = view.dispatch.bind(view);
    window.benchmarkDispatch = dispatch;
    window.benchmarkCompartment = new Compartment();
    view.dispatch = (...args) => {
      const start = performance.now();
      dispatch(...args);
      const duration = performance.now() - start;
      if (duration > 20) result.dispatches.push({ start, duration });
    };
    view.dispatch({ effects: StateEffect.appendConfig.of(window.benchmarkCompartment.of(EditorView.updateListener.of(update => {
      if (!update.docChanged) return;
      result.transactions++;
      update.changes.iterChanges((from, to) => {
        if (from === 0 && to === update.startState.doc.length) result.replacements++;
      });
    }))) });
    window.benchmarkObserver = new PerformanceObserver(list => result.longTasks.push(...list.getEntries().map(e => ({ start: e.startTime, duration: e.duration }))));
    window.benchmarkObserver.observe({ type: "longtask" });
    window.benchmarkKeyDown = () => {
      const start = performance.now();
      requestAnimationFrame(() => result.frames.push(performance.now() - start));
    };
    document.querySelector(".cm-content").addEventListener("keydown", window.benchmarkKeyDown, { capture: true });
  });
  let expected = initial;
  const start = Date.now();
  for (let index = 0; index < 900; index++) {
    const key = index % 90 === 89 ? "Enter" : index % 90 > 69 ? "Backspace" : "a";
    expected = key === "Enter" ? expected + "\n" : key === "Backspace" ? expected.slice(0, -1) : expected + "a";
    await page.keyboard.press(key);
    const delay = start + (index + 1) * (1000 / 30) - Date.now();
    if (delay > 0) await page.waitForTimeout(delay);
  }
  const elapsed = Date.now() - start;
  await page.waitForTimeout(1000);
  await page.evaluate(({ expected, elapsed }) => {
    window.benchmarkObserver.disconnect();
    const result = window.editorBenchmark;
    result.frames.sort((a, b) => a - b);
    result.p95 = result.frames[Math.floor(result.frames.length * .95)];
    result.maxFrame = Math.max(...result.frames);
    result.frameCount = result.frames.length;
    result.maxLongTask = Math.max(0, ...result.longTasks.map(task => task.duration));
    result.matches = window.benchmarkView.state.doc.toString() === expected;
    result.expectedLength = expected.length;
    result.actualLength = window.benchmarkView.state.doc.length;
    result.elapsed = elapsed;
    const stored = JSON.parse(localStorage.getItem("taskmate-browser-demo"));
    result.persisted = stored.tasks.some(task => task.body === expected);
    document.querySelector(".cm-content").removeEventListener("keydown", window.benchmarkKeyDown, { capture: true });
    window.benchmarkView.dispatch({ effects: window.benchmarkCompartment.reconfigure([]) });
    window.benchmarkView.dispatch = window.benchmarkDispatch;
    delete result.frames;
  }, { expected, elapsed });
}
