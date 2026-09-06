import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FolderNavigator, TASK_DRAG_TYPE } from "./FolderNavigator";

function setup() {
  const onSelect = vi.fn();
  const onExpand = vi.fn();
  const onDrop = vi.fn();
  render(<FolderNavigator folders={[{ path: "a", archived: false }, { path: "a/child", archived: false }, { path: "empty", archived: false }, { path: "archived", archived: true }]} archived={false} selected={null} expanded={[]} onSelect={onSelect} onExpand={onExpand} onAction={vi.fn()} onDrop={onDrop} checked={0} onSelectAll={vi.fn()} onMoveSelected={vi.fn()} busy={false} />);
  return { onSelect, onExpand, onDrop };
}

describe("FolderNavigator", () => {
  it("shows empty folders, hides collapsed descendants and selects all or root", () => {
    const { onSelect, onExpand } = setup();
    expect(screen.getByRole("button", { name: "empty" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "child" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "archived" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Root tasks" }));
    expect(onSelect).toHaveBeenLastCalledWith("");
    fireEvent.click(screen.getByRole("button", { name: "All tasks" }));
    expect(onSelect).toHaveBeenLastCalledWith(null);
    fireEvent.click(screen.getByRole("button", { name: "Expand a" }));
    expect(onExpand).toHaveBeenCalledWith(["a"]);
  });
  it("accepts task groups and folders only in the same region", () => {
    const { onDrop } = setup();
    const target = screen.getByRole("button", { name: "empty" });
    const drop = (payload: unknown) => fireEvent.drop(target, { dataTransfer: { getData: (type: string) => type === TASK_DRAG_TYPE ? JSON.stringify(payload) : "" } });
    drop({ archived: false, ids: ["1", "2"] });
    expect(onDrop).toHaveBeenLastCalledWith({ archived: false, ids: ["1", "2"] }, "empty");
    drop({ archived: false, folder: "a" });
    expect(onDrop).toHaveBeenLastCalledWith({ archived: false, folder: "a" }, "empty");
    drop({ archived: true, ids: ["3"] });
    drop({ ids: ["3"] });
    expect(onDrop).toHaveBeenCalledTimes(2);
  });
});
