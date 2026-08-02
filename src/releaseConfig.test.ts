import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const files = [
  "package.json",
  "src-tauri/Cargo.toml",
  "src-tauri/tauri.conf.json",
  ".github/workflows/release.yml",
  "src/hooks/useUpdater.ts",
];
const placeholders = ["YOUR_GITHUB_OWNER", "Your App", "your-app", "REPLACE_WITH_TEMPLATE_INIT", "__TEMPLATE_INITIALIZED__"];

describe("release configuration", () => {
  it("uses Taskmate's permanent identity and updater endpoint", () => {
    const config = JSON.parse(readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8"));
    expect(config.productName).toBe("Taskmate");
    expect(config.identifier).toBe("net.itvincent.taskmate");
    expect(config.bundle.createUpdaterArtifacts).toBe(true);
    expect(config.bundle.macOS.signingIdentity).toBe("-");
    expect(config.plugins.updater.endpoints).toEqual(["https://github.com/itvincent-git/taskmate/releases/latest/download/latest.json"]);
    expect(config.plugins.updater.pubkey).not.toBe("");
  });

  it("does not retain template placeholders in release files", () => {
    for (const file of files) {
      const source = readFileSync(join(root, file), "utf8");
      for (const placeholder of placeholders) expect(source, file).not.toContain(placeholder);
    }
  });

  it("publishes generated release notes to GitHub and the updater manifest", () => {
    const workflow = readFileSync(join(root, ".github/workflows/release.yml"), "utf8");
    expect(workflow).toContain("releaseBody: ${{ steps.release_notes.outputs.body }}");
    expect(workflow).toContain("'{version:$version,notes:$notes,pub_date:$date,platforms:{");
    expect(JSON.parse(readFileSync(join(root, "changelog.json"), "utf8"))).toEqual(expect.any(Object));
  });
});
