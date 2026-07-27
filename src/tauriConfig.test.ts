import { describe, expect, it } from "vitest";
import capabilities from "../src-tauri/capabilities/default.json";

describe("Tauri window capabilities", () => {
  it("allows the custom title bar to start native window dragging", () => {
    expect(capabilities.permissions).toContain("core:window:allow-start-dragging");
  });
});
