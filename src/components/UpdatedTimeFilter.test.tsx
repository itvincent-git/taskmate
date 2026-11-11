import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { UpdatedTimeFilter } from "./UpdatedTimeFilter";

it("defaults to 7 or 30 days, validates positive integers and restores controlled conditions", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  const { rerender } = render(<UpdatedTimeFilter onChange={onChange} />);
  await user.click(screen.getByLabelText("Updated time"));
  await user.click(await screen.findByRole("option", { name: "Updated in the last N days" }));
  expect(onChange).toHaveBeenLastCalledWith([{ key: "updatedAt", operator: "withinLastDays", value: 7 }]);
  rerender(<UpdatedTimeFilter current={{ key: "updatedAt", operator: "withinLastDays", value: 7 }} onChange={onChange} />);
  fireEvent.change(screen.getByLabelText("Number of days"), { target: { value: "0" } });
  expect(screen.getByRole("alert")).toHaveTextContent("positive whole number");
  expect(onChange).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText("Number of days"), { target: { value: "12" } });
  expect(onChange).toHaveBeenLastCalledWith([{ key: "updatedAt", operator: "withinLastDays", value: 12 }]);
  await user.click(screen.getByLabelText("Updated time"));
  await user.click(await screen.findByRole("option", { name: "Not updated for over N days" }));
  expect(onChange).toHaveBeenLastCalledWith([{ key: "updatedAt", operator: "olderThanDays", value: 30 }]);
  rerender(<UpdatedTimeFilter current={{ key: "updatedAt", operator: "olderThanDays", value: 90 }} onChange={onChange} />);
  expect(screen.getByLabelText("Number of days")).toHaveValue(90);
});
