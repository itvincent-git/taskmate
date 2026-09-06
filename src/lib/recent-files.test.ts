import { beforeEach, expect, it } from "vitest";
import { loadRecentFiles, saveRecentFiles } from "./recent-files";

beforeEach(() => localStorage.clear());

it("keeps history isolated by workspace", () => {
  const first = { id: "same-id", title: "First", fileName: "First.md", archived: false };
  const second = { ...first, title: "Second", archived: true };
  saveRecentFiles("/first", [first]);
  saveRecentFiles("/second", [second]);
  expect(loadRecentFiles("/first")).toEqual([first]);
  expect(loadRecentFiles("/second")).toEqual([second]);
  expect(loadRecentFiles("/unknown")).toEqual([]);
});

it("ignores malformed history and duplicate entries", () => {
  localStorage.setItem("taskmate-recent-files.v1", "invalid JSON");
  expect(loadRecentFiles("/first")).toEqual([]);
  const file = { id: "a", title: "A", fileName: "A.md", archived: false };
  localStorage.setItem("taskmate-recent-files.v1", JSON.stringify({ "/first": [null, {}, file, file] }));
  expect(loadRecentFiles("/first")).toEqual([file]);
});
