import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PropertyDefinition, Task } from "../types";
import { TaskProperties } from "./TaskProperties";

const definition: PropertyDefinition = {
  id: "status",
  key: "status",
  name: "Status",
  type: "text",
  showInDetail: true,
  showInCard: true,
  enableFilter: true,
  enableSort: true,
  options: [],
  order: 0,
};
const definitions = [definition];

const task: Task = {
  id: "task",
  title: "Initial title",
  fileName: "task.md",
  body: "Initial body",
  contentHash: "hash",
  archived: false,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  properties: { status: "Todo" },
};

describe("TaskProperties", () => {
  it("does not rerender property inputs for title and body edits", () => {
    const properties = new Proxy(task.properties, {
      get(target, key, receiver) {
        propertyReads += 1;
        return Reflect.get(target, key, receiver);
      },
    });
    const onChange = vi.fn();
    let propertyReads = 0;
    const { rerender } = render(
      <TaskProperties definitions={definitions} task={{ ...task, properties }} onChange={onChange} />,
    );
    const readsAfterInitialRender = propertyReads;

    rerender(
      <TaskProperties
        definitions={definitions}
        task={{ ...task, title: "Edited title", body: "Edited body", properties }}
        onChange={onChange}
      />,
    );

    expect(screen.getByLabelText("Status")).toHaveValue("Todo");
    expect(propertyReads).toBe(readsAfterInitialRender);
  });

  it("edits custom date fields with a calendar and allows clearing them", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <TaskProperties
        definitions={[{ ...definition, id: "due", key: "due", name: "Due date", type: "date" }]}
        task={{ ...task, properties: { due: "2026-08-15" } }}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Due date" }));
    expect(screen.getByRole("grid")).toBeInTheDocument();

    const nextDate = document.querySelector<HTMLButtonElement>('[data-day="2026-08-17"] button');
    expect(nextDate).not.toBeNull();
    await user.click(nextDate!);
    expect(onChange).toHaveBeenLastCalledWith("due", "2026-08-17");

    await user.click(screen.getByRole("button", { name: "Unset Due date" }));
    expect(onChange).toHaveBeenLastCalledWith("due", null);
  });
});
