import test from "node:test";
import assert from "node:assert/strict";
import { nextVersion } from "./version-lib.mjs";

test("computes semantic release versions", () => {
  assert.equal(nextVersion("1.2.3", "patch"), "1.2.4");
  assert.equal(nextVersion("1.2.3", "minor"), "1.3.0");
  assert.equal(nextVersion("1.2.3", "major"), "2.0.0");
  assert.equal(nextVersion("1.2.3", "2.1.0"), "2.1.0");
  assert.throws(() => nextVersion("1.2.3", "1.2.3"), /greater/);
});
