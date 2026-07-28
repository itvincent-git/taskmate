import { describe, expect, it } from "vitest";
import { api, taskFilePath } from "./api";

describe("taskFilePath", () => {
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
