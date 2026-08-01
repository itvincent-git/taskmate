import { beforeEach, describe, expect, it } from "vitest";
import { api, taskFilePath } from "./api";

describe("default properties", () => {
  beforeEach(() => localStorage.clear());

  it("exposes the current built-in schema", async () => {
    const snapshot = await api.openWorkspace("/tmp/tasks");

    expect(snapshot.properties.map((property) => property.key)).toEqual([
      "status",
      "priority",
      "tags",
      "startDate",
      "endDate",
    ]);
  });
});

describe("taskFilePath", () => {
  beforeEach(() => localStorage.clear());
  it("resolves active and archived task files from the workspace path", () => {
    expect(taskFilePath("/Users/example/Taskmate", {
      archived: false,
      fileName: "Actual active name.md",
    })).toBe("/Users/example/Taskmate/tasks/Actual active name.md");

    expect(taskFilePath("/Users/example/Taskmate/", {
      archived: true,
      fileName: "Actual archived name.md",
    })).toBe("/Users/example/Taskmate/archive/Actual archived name.md");
  });

  it("exposes task path resolution through the frontend API", async () => {
    await expect(api.resolveTaskFilePath("/Users/example/Taskmate", {
      archived: true,
      fileName: "Archived.md",
    })).resolves.toBe("/Users/example/Taskmate/archive/Archived.md");
  });

  it("preserves Windows path separators", () => {
    expect(taskFilePath("C:\\Users\\example\\Taskmate", {
      archived: false,
      fileName: "Task.md",
    })).toBe("C:\\Users\\example\\Taskmate\\tasks\\Task.md");
  });
});

describe("createPropertyOption", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("taskmate-browser-demo", JSON.stringify({
      path: "/tmp/tasks",
      properties: [
        { id: "tags", key: "tags", name: "Tags", type: "tags", showInDetail: true, showInCard: true, enableFilter: true, enableSort: false, order: 0, options: [] },
        { id: "status", key: "status", name: "Status", type: "select", showInDetail: true, showInCard: true, enableFilter: true, enableSort: true, order: 1, options: [] },
      ],
      tasks: [],
    }));
  });

  it("atomically persists creatable tags and treats repeated labels as the same option", async () => {
    const created = await api.createPropertyOption("tags", "  Release, 1  ");
    expect(created).toEqual({ id: "Release, 1", label: "Release, 1", color: "#9C9C9C", order: 0 });
    await expect(api.createPropertyOption("tags", "release, 1")).resolves.toEqual(created);
    const stored = JSON.parse(localStorage.getItem("taskmate-browser-demo")!);
    expect(stored.properties[0].options).toEqual([created]);
  });

  it("rejects empty labels, missing properties, and non-tag properties", async () => {
    await expect(api.createPropertyOption("tags", "  ")).rejects.toThrow("empty");
    await expect(api.createPropertyOption("missing", "Later")).rejects.toThrow("not found");
    await expect(api.createPropertyOption("status", "Later")).rejects.toThrow("only");
  });
});

describe("searchTasks", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("taskmate-browser-demo", JSON.stringify({
      path: "/tmp/tasks",
      properties: [],
      tasks: [
        { id: "title", title: "Needle title", fileName: "a.md", body: "Opening text", archived: false, createdAt: "2026-01-01", updatedAt: "2026-01-02", properties: {}, contentHash: "a" },
        { id: "body", title: "Body result", fileName: "b.md", body: `${"界".repeat(120)} needle ${"尾".repeat(200)}`, archived: true, createdAt: "2026-01-01", updatedAt: "2026-01-03", properties: {}, contentHash: "b" },
        { id: "ignored", title: "Ignored", fileName: "needle.md", body: "No match", archived: false, createdAt: "2026-01-01", updatedAt: "2026-01-04", properties: { note: "needle" }, contentHash: "c" },
      ],
    }));
  });

  it("searches only titles and bodies across active and archived tasks", async () => {
    const results = await api.searchTasks("needle");
    expect(results.map((result) => result.id)).toEqual(["title", "body"]);
    expect(results[1]).toMatchObject({ archived: true });
    expect(results[1].snippet).toContain("needle");
    expect(Array.from(results[1].snippet)).toHaveLength(200);
  });

  it("does not search blank text", async () => {
    await expect(api.searchTasks("   ")).resolves.toEqual([]);
  });
});

describe("queryTasks", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("taskmate-browser-demo", JSON.stringify({
      path: "/tmp/tasks",
      properties: [],
      tasks: [
        { id: "a", title: "Alpha", fileName: "a.md", body: "", archived: false, createdAt: "2026-01-01", updatedAt: "2026-01-02", properties: { status: "doing", score: 2 }, contentHash: "a" },
        { id: "b", title: "Beta", fileName: "b.md", body: "", archived: false, createdAt: "2026-01-01", updatedAt: "2026-01-03", properties: { status: "doing", score: 10 }, contentHash: "b" },
        { id: "c", title: "Charlie", fileName: "c.md", body: "", archived: false, createdAt: "2026-01-01", updatedAt: "2026-01-04", properties: { status: "done" }, contentHash: "c" },
        { id: "d", title: "Delta", fileName: "d.md", body: "", archived: false, createdAt: "2026-01-01", updatedAt: "2026-01-05", properties: { status: "doing" }, contentHash: "d" },
      ],
    }));
  });

  it("applies sort fields in priority order with per-field null placement", async () => {
    const results = await api.queryTasks({
      search: "",
      archived: false,
      filters: [],
      sorts: [
        { key: "status", direction: "desc", nulls: "last" },
        { key: "score", direction: "desc", nulls: "first" },
      ],
    });

    expect(results.map((task) => task.id)).toEqual(["c", "d", "b", "a"]);
  });
});
