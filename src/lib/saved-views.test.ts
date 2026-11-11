import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { invalidViewReference, loadWorkViewState, parseViewsFile, sameWorkViewQuery, saveWorkViewState, viewNameError, WORK_VIEW_STATE_KEY } from "./saved-views";
import type { SavedWorkView } from "../types";

const view: SavedWorkView = { id: "one", name: "Recent", filters: [{ key: "updatedAt", operator: "withinLastDays", value: 7 }], sorts: [{ key: "updatedAt", direction: "desc", nulls: "last" }], folderPath: null, archived: false };

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("saved views", () => {
  it("creates files lazily, trims and validates names, and isolates workspaces", async () => {
    await expect(api.loadViews("/a")).resolves.toEqual({ views: [], contentHash: null });
    expect(localStorage.length).toBe(0);
    const saved = await api.saveViews("/a", [{ ...view, name: "  Recent  " }], null);
    expect(saved.views[0].name).toBe("Recent");
    await expect(api.loadViews("/b")).resolves.toEqual({ views: [], contentHash: null });
    await expect(api.saveViews("/a", [{ ...view, name: "  " }], saved.contentHash)).rejects.toThrow();
    await expect(api.saveViews("/a", [view, { ...view, id: "two" }], saved.contentHash)).rejects.toThrow();
    expect((await api.loadViews("/a")).views).toEqual([view]);
    expect(viewNameError("  Recent ", [view])).toBe("duplicate");
    expect(viewNameError("Recent", [view], view.id)).toBeNull();
    expect(viewNameError(" ", [])).toBe("empty");
  });

  it("rejects external changes and corrupt files without overwriting them", async () => {
    const saved = await api.saveViews("/a", [view], null);
    const external = JSON.stringify({ version: 1, views: [{ ...view, name: "External" }] });
    localStorage.setItem("taskmate-browser-demo:views:/a", external);
    await expect(api.saveViews("/a", [], saved.contentHash)).rejects.toThrow("VIEWS_CONFLICT");
    expect(localStorage.getItem("taskmate-browser-demo:views:/a")).toBe(external);
    for (const raw of ["broken", '{"version":2,"views":[]}', '{"version":1,"views":[{}]}']) {
      localStorage.setItem("taskmate-browser-demo:views:/a", raw);
      await expect(api.loadViews("/a")).rejects.toThrow();
      await expect(api.saveViews("/a", [], null)).rejects.toThrow();
      expect(localStorage.getItem("taskmate-browser-demo:views:/a")).toBe(raw);
    }
    expect(() => parseViewsFile('{"version":1,"views":[]}')).not.toThrow();
  });

  it("compares only saved conditions, ignores filter ordering, and preserves sort priority", () => {
    const filters = [...view.filters, { key: "status", operator: "eq", value: "done" }];
    expect(sameWorkViewQuery({ ...view, filters }, { ...view, filters: [...filters].reverse() })).toBe(true);
    expect(sameWorkViewQuery(view, { ...view, folderPath: "" })).toBe(false);
    expect(sameWorkViewQuery(view, { ...view, archived: true })).toBe(false);
    expect(sameWorkViewQuery({ ...view, filters: [{ key: "status", operator: "unset" }] }, { ...view, filters: [{ key: "status", operator: "unset", value: null }] })).toBe(true);
    const sorts = [...view.sorts, { key: "title", direction: "asc" as const, nulls: "last" as const }];
    expect(sameWorkViewQuery({ ...view, sorts }, { ...view, sorts: [...sorts].reverse() })).toBe(false);
  });

  it("persists modified queries and association per workspace without search or layout state", () => {
    const query = { ...view, search: "private search", archived: true };
    saveWorkViewState("/a", query, "one");
    saveWorkViewState("/b", { ...query, archived: false }, null);
    expect(loadWorkViewState("/a")).toEqual({ query: { filters: view.filters, sorts: view.sorts, archived: true, folderPath: null }, viewId: "one" });
    expect(loadWorkViewState("/b")?.viewId).toBeNull();
    expect(sameWorkViewQuery(loadWorkViewState("/a")!.query, view)).toBe(false);
    expect(localStorage.getItem(WORK_VIEW_STATE_KEY)).not.toContain("private search");
    localStorage.setItem(WORK_VIEW_STATE_KEY, "broken");
    expect(loadWorkViewState("/a")).toBeNull();
  });

  it("rejects missing folders, properties and enum options while preserving root semantics", async () => {
    const { properties } = await api.openWorkspace("/a");
    const filters = [{ key: "status", operator: "eq", value: "done" }];
    expect(invalidViewReference({ ...view, filters }, properties, [])).toBeNull();
    expect(invalidViewReference({ ...view, folderPath: "" }, properties, [])).toBeNull();
    expect(invalidViewReference({ ...view, folderPath: "project", archived: true }, properties, [{ path: "project", archived: false }])?.kind).toBe("folder");
    expect(invalidViewReference({ ...view, filters: [{ ...filters[0], key: "removed" }] }, properties, [])?.kind).toBe("property");
    expect(invalidViewReference({ ...view, filters: [{ ...filters[0], value: "removed" }] }, properties, [])?.kind).toBe("option");
    expect(invalidViewReference({ ...view, sorts: [{ key: "removed", direction: "asc", nulls: "last" }] }, properties, [])?.kind).toBe("property");
  });
});

describe("demo workspace and time query parity", () => {
  it("keeps workspace data isolated on switches", async () => {
    await api.openWorkspace("/a");
    const task = await api.createTask("Only A");
    await api.openWorkspace("/b");
    await expect(api.getTask(task.id)).rejects.toThrow();
    await api.openWorkspace("/a");
    expect((await api.getTask(task.id)).title).toBe("Only A");
  });

  it("uses inclusive rolling bounds and offsets, excludes future and invalid timestamps", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-11T12:00:00Z"));
    await api.openWorkspace("/a");
    const template = await api.createTask("Template");
    const timestamps = ["2026-11-04T20:00:00+08:00", "2026-11-04T11:59:59.999Z", "2026-11-11T12:00:00Z", "2026-11-11T12:00:00.001Z", "invalid", "2026-11-04", "2026-02-30T12:00:00Z"];
    const state = JSON.parse(localStorage.getItem("taskmate-browser-demo")!);
    state.tasks = timestamps.map((updatedAt, index) => ({ ...template, id: String(index), updatedAt }));
    localStorage.setItem("taskmate-browser-demo", JSON.stringify(state));
    const query = { search: "", archived: false, filters: view.filters, sorts: [] };
    expect((await api.queryTasks(query)).map((t) => t.id).sort()).toEqual(["0", "2"]);
    expect((await api.queryTasks({ ...query, filters: [{ ...view.filters[0], operator: "olderThanDays" }] })).map((t) => t.id)).toEqual(["1"]);
    for (const value of [0, -1, 1.5, "7", null]) expect(await api.queryTasks({ ...query, filters: [{ ...view.filters[0], value }] })).toEqual([]);
  });
});
