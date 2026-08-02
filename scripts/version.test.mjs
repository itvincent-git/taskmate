import test from "node:test";
import assert from "node:assert/strict";
import { nextVersion, releaseNotes } from "./version-lib.mjs";

test("computes semantic release versions", () => {
  assert.equal(nextVersion("1.2.3", "patch"), "1.2.4");
  assert.equal(nextVersion("1.2.3", "minor"), "1.3.0");
  assert.equal(nextVersion("1.2.3", "major"), "2.0.0");
  assert.equal(nextVersion("1.2.3", "2.1.0"), "2.1.0");
  assert.throws(() => nextVersion("1.2.3", "1.2.3"), /greater/);
});

test("formats release notes without release or merge commits", () => {
  assert.equal(
    releaseNotes(["feat: show update details", "chore(release): 0.6.1", "Merge branch 'main'", "fix: keep notes available"]),
    "- feat: show update details\n- fix: keep notes available",
  );
  assert.equal(releaseNotes([]), "- Minor updates and bug fixes.");
});
