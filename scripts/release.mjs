#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { nextVersion } from "./version-lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2];

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

try {
  if (!target || process.argv.length !== 3) throw new Error("Usage: pnpm release <major|minor|patch|x.y.z>");
  if (!existsSync(join(root, ".template-initialized.json"))) throw new Error("Run template:init before releasing.");
  const status = git(["status", "--porcelain", "--untracked-files=all"]);
  if (status) throw new Error(`Git working tree must be clean:\n${status}`);

  const packagePath = join(root, "package.json");
  const cargoPath = join(root, "src-tauri/Cargo.toml");
  const configPath = join(root, "src-tauri/tauri.conf.json");
  const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
  const version = nextVersion(pkg.version, target);
  const tag = `app-v${version}`;
  if (git(["tag", "--list", tag]) === tag) throw new Error(`Tag ${tag} already exists.`);

  pkg.version = version;
  writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.version = version;
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  writeFileSync(cargoPath, readFileSync(cargoPath, "utf8").replace(/^version = ".*"$/m, `version = "${version}"`));
  execFileSync("pnpm", ["install", "--lockfile-only"], { cwd: root, stdio: "inherit" });
  execFileSync("cargo", ["check", "--manifest-path", "src-tauri/Cargo.toml"], { cwd: root, stdio: "inherit" });
  git(["add", "package.json", "pnpm-lock.yaml", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock", "src-tauri/tauri.conf.json"]);
  git(["commit", "-m", `chore(release): ${version}`]);
  git(["tag", "-a", tag, "-m", tag]);
  console.log(`Created release commit and annotated tag ${tag}. Push them when ready.`);
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
