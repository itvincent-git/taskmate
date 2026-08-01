import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PropertyDefinition } from "../types";
import { PropertySettings } from "./PropertySettings";

const tags: PropertyDefinition = {
  id: "tags",
  key: "tags",
  name: "Tags",
  type: "tags",
  showInDetail: true,
  showInCard: true,
  enableFilter: true,
  enableSort: false,
  options: [],
  order: 0,
  defaultValue: [],
};

describe("PropertySettings", () => {
  it("keeps newly created default tags in the draft until Save is used", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onSave = vi.fn();
    render(<PropertySettings definitions={[tags]} lockedIds={new Set()} onChange={onChange} onSave={onSave} onRebuild={vi.fn()} saving={false} />);

    await user.type(screen.getByRole("textbox", { name: "Tags" }), "Draft tag{Enter}");

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const definitions = onChange.mock.calls.at(-1)![0] as PropertyDefinition[];
    expect(definitions[0]).toMatchObject({
      defaultValue: ["Draft tag"],
      options: [{ id: "Draft tag", label: "Draft tag", color: "#9C9C9C", order: 0 }],
    });
    expect(onSave).not.toHaveBeenCalled();
  });
});
