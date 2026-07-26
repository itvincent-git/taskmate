import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeTemplate, parseArguments, runSigner } from "./template-init-lib.mjs";

const root = join(import.meta.dirname, "..");
const valid = { name: "Sample App", slug: "sample-app", identifier: "dev.example.sample-app", repo: "acme/sample-app", author: "Ada" };

function fixture() {
  const target = mkdtempSync(join(tmpdir(), "tauri-template-"));
  const files = [
    "package.json",
    "index.html",
    "README.md",
    "LICENSE",
    ".gitignore",
    "src/App.tsx",
    "src/lib/i18n.ts",
    "src/hooks/usePreferences.ts",
    "src/hooks/useUpdater.ts",
    "src-tauri/Cargo.toml",
    "src-tauri/Cargo.lock",
    "src-tauri/tauri.conf.json",
    "src-tauri/src/main.rs",
    "src-tauri/src/lib.rs",
    ".github/workflows/release.yml",
  ];
  for (const path of files) {
    mkdirSync(join(target, path, ".."), { recursive: true });
    cpSync(join(root, path), join(target, path));
  }
  return target;
}

function signer({ root: target, slug }) {
  const keyPath = join(target, ".tauri-signing", `${slug}.key`);
  const directory = join(target, ".tauri-signing");
  mkdirSync(directory, { recursive: true });
  writeFileSync(keyPath, "PRIVATE");
  writeFileSync(`${keyPath}.pub`, "PUBLIC");
  return { keyPath, publicPath: `${keyPath}.pub`, publicKey: "PUBLIC" };
}

test("validates initialization arguments", () => {
  assert.throws(() => parseArguments(["--name", "A", "--slug", "Bad Slug", "--identifier", "dev.a", "--repo", "a/b", "--author", "A"]), /kebab-case/);
  assert.throws(() => parseArguments(["--name", "A"]), /Missing required/);
  assert.deepEqual(parseArguments(Object.entries(valid).flatMap(([key, value]) => [`--${key}`, value])), valid);
});

test("replaces identity, embeds the public key, ignores private keys, and refuses reruns", () => {
  const target = fixture();
  try {
    const result = initializeTemplate({ root: target, options: valid, checkClean: false, password: "secret", signer });
    assert.equal(readFileSync(result.keyPath, "utf8"), "PRIVATE");
    assert.match(readFileSync(join(target, ".gitignore"), "utf8"), /\.tauri-signing\//);
    assert.match(readFileSync(join(target, "package.json"), "utf8"), /sample-app/);
    assert.match(readFileSync(join(target, "src-tauri/Cargo.lock"), "utf8"), /name = "sample-app"/);
    assert.equal(JSON.parse(readFileSync(join(target, "src-tauri/tauri.conf.json"))).plugins.updater.pubkey, "PUBLIC");
    assert.throws(() => initializeTemplate({ root: target, options: valid, checkClean: false, password: "secret", signer }), /already/);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("rolls back changed files and keys after a failure", () => {
  const target = fixture();
  const before = readFileSync(join(target, "package.json"), "utf8");
  try {
    assert.throws(() => initializeTemplate({
      root: target,
      options: valid,
      checkClean: false,
      password: "secret",
      signer: (args) => {
        const generated = signer(args);
        rmSync(join(target, "README.md"));
        return generated;
      },
    }));
    assert.equal(readFileSync(join(target, "package.json"), "utf8"), before);
    assert.equal(existsSync(join(target, ".tauri-signing", "sample-app.key")), false);
    assert.equal(existsSync(join(target, ".template-initialized.json")), false);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("signer wrapper removes partial key output when the command fails", () => {
  const target = mkdtempSync(join(tmpdir(), "tauri-signer-"));
  const keyPath = join(target, ".tauri-signing", "sample-app.key");
  try {
    assert.throws(() => runSigner({
      root: target,
      slug: "sample-app",
      password: "secret",
      spawn: () => {
        writeFileSync(keyPath, "PARTIAL");
        return { status: 1, stderr: "simulated failure" };
      },
    }), /simulated failure/);
    assert.equal(existsSync(keyPath), false);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
