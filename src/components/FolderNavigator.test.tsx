import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FolderNavigator, TASK_DRAG_TYPE } from "./FolderNavigator";

function setup(onAction = vi.fn(async () => true)) {
  const onSelect = vi.fn();
  const onExpand = vi.fn();
  const onDrop = vi.fn();
  render(<FolderNavigator folders={[{ path: "a", archived: false }, { path: "a/child", archived: false }, { path: "empty", archived: false }, { path: "archived", archived: true }]} archived={false} selected={null} expanded={[]} onSelect={onSelect} onExpand={onExpand} onAction={onAction} onDrop={onDrop} checked={0} onSelectAll={vi.fn()} onMoveSelected={vi.fn()} busy={false} />);
  return { onSelect, onExpand, onDrop, onAction };
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
  it("selects a parent folder with the shared Select control", async () => {
    const user = userEvent.setup();
    const { onAction } = setup();

    await user.click(screen.getByRole("button", { name: "New folder" }));
    const parent = screen.getByRole("combobox", { name: "Parent folder" });
    expect(parent).toHaveClass("w-full");
    await user.click(parent);
    await user.click(screen.getByRole("option", { name: /^a$/ }));
    await user.type(screen.getByLabelText("Folder name"), "nested");
    await user.click(screen.getByRole("button", { name: "Apply" }));

    expect(onAction).toHaveBeenCalledWith({ kind: "create", source: "", parent: "a", name: "nested" });
  });
});
