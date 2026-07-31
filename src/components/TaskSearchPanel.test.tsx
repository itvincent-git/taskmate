import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TaskmateI18nProvider } from "../lib/taskmate-i18n";
import { TaskSearchPanel } from "./TaskSearchPanel";

const virtualizerMock = vi.hoisted(() => {
  let count = 0;
  const virtualizer = {
    measure: vi.fn(),
    measureElement: vi.fn(),
    getTotalSize: () => count * 92,
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, key: index, start: index * 92, end: (index + 1) * 92, size: 92, lane: 0 })),
  };
  return { virtualizer, setCount: (next: number) => { count = next; } };
});

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (options: { count: number }) => {
    virtualizerMock.setCount(options.count);
    return virtualizerMock.virtualizer;
  },
}));

function renderPanel(overrides: Partial<React.ComponentProps<typeof TaskSearchPanel>> = {}) {
  const props: React.ComponentProps<typeof TaskSearchPanel> = {
    search: "a+b",
    results: [{ id: "one", title: "Fix a+b", archived: true, snippet: "Use literal a+b safely" }],
    loading: false,
    onSearchChange: vi.fn(),
    onSelect: vi.fn(),
    ...overrides,
  };
  render(<TaskmateI18nProvider><TaskSearchPanel {...props} /></TaskmateI18nProvider>);
  return props;
}

describe("TaskSearchPanel", () => {
  it("highlights literal title and body matches and opens archived results", async () => {
    const user = userEvent.setup();
    const props = renderPanel();
    const result = screen.getByRole("button", { name: /Fix a\+b/ });

    expect(within(result).getAllByText("a+b")).toHaveLength(2);
    expect(result.querySelectorAll("mark")).toHaveLength(2);
    expect(within(result).getByText("Archived")).toBeInTheDocument();
    await user.click(result);
    expect(props.onSelect).toHaveBeenCalledWith(props.results[0]);
  });

  it("shows blank, loading, and no-result states", () => {
    const first = renderPanel({ search: "", results: [] });
    expect(screen.getByText("Search your workspace")).toBeInTheDocument();
    first.results = [];

    const { rerender } = render(<TaskmateI18nProvider><TaskSearchPanel {...first} search="missing" loading /></TaskmateI18nProvider>);
    expect(screen.getByText("Searching…")).toBeInTheDocument();
    rerender(<TaskmateI18nProvider><TaskSearchPanel {...first} search="missing" loading={false} /></TaskmateI18nProvider>);
    expect(screen.getByText("No results")).toBeInTheDocument();
  });
});
