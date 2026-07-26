import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const IDENTIFIER = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+(?:-[a-z0-9]+)*$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || !value) throw new Error(`Invalid argument near "${flag ?? ""}".`);
    values[flag.slice(2)] = value;
  }
  for (const key of ["name", "slug", "identifier", "repo", "author"]) {
    if (!values[key]?.trim()) throw new Error(`Missing required option --${key}.`);
  }
  if (values.name.trim().length > 80) throw new Error("Application name must be 80 characters or fewer.");
  if (!SLUG.test(values.slug)) throw new Error("Slug must use kebab-case.");
  if (!IDENTIFIER.test(values.identifier)) throw new Error("Identifier must be a reverse-domain value.");
  if (!REPOSITORY.test(values.repo)) throw new Error("Repository must use owner/repo format.");
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.trim()]));
}

function assertCleanRepository(root) {
  const output = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  if (output) throw new Error(`Git working tree must be clean:\n${output}`);
}

function replaceAll(source, replacements) {
  let result = source;
  for (const [from, to] of replacements) result = result.split(from).join(to);
  return result;
}

export function runSigner({ root, slug, password, spawn = spawnSync }) {
  const keyPath = join(root, ".tauri-signing", `${slug}.key`);
  mkdirSync(dirname(keyPath), { recursive: true });
  const result = spawn(
    "pnpm",
    ["exec", "tauri", "signer", "generate", "-w", keyPath, "--password", password],
    { cwd: root, encoding: "utf8" },
  );
  if (result.status !== 0) {
    rmSync(keyPath, { force: true });
    rmSync(`${keyPath}.pub`, { force: true });
    throw new Error(`Signing key generation failed: ${(result.stderr || result.stdout || "").trim()}`);
  }
  const publicPath = `${keyPath}.pub`;
  if (!existsSync(keyPath) || !existsSync(publicPath)) {
    rmSync(keyPath, { force: true });
    rmSync(publicPath, { force: true });
    throw new Error("Signer did not produce both the private and public key files.");
  }
  return { keyPath, publicKey: readFileSync(publicPath, "utf8").trim(), publicPath };
}

export function initializeTemplate({
  root,
  options,
  checkClean = true,
  signer = runSigner,
  password = process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD,
}) {
  const marker = join(root, ".template-initialized.json");
  if (existsSync(marker)) throw new Error("This template has already been initialized.");
  if (!password) throw new Error("TAURI_SIGNING_PRIVATE_KEY_PASSWORD is required.");
  if (checkClean) assertCleanRepository(root);

  const owner = options.repo.split("/")[0];
  const files = [
    "package.json",
    "index.html",
    "README.md",
    "LICENSE",
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
  const originals = new Map();
  let generated;

  try {
    generated = signer({ root, slug: options.slug, password });
    const replacements = [
      ["YOUR_GITHUB_OWNER/your-app", options.repo],
      ["YOUR_GITHUB_OWNER", owner],
      ["com.example.your-app", options.identifier],
      ["your_app_lib", `${options.slug.replaceAll("-", "_")}_lib`],
      ["your-app", options.slug],
      ["Your App", options.name],
      ["Your Name", options.author],
      ["__TEMPLATE_INITIALIZED__", "true"],
    ];

    for (const relative of files) {
      const path = join(root, relative);
      const source = readFileSync(path, "utf8");
      originals.set(path, source);
      writeFileSync(path, replaceAll(source, replacements));
    }

    const configPath = join(root, "src-tauri/tauri.conf.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.plugins.updater.pubkey = generated.publicKey;
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    writeFileSync(marker, `${JSON.stringify({ name: options.name, slug: options.slug, repository: options.repo }, null, 2)}\n`);
    rmSync(generated.publicPath);
    return { keyPath: generated.keyPath, publicKey: generated.publicKey };
  } catch (error) {
    for (const [path, source] of originals) writeFileSync(path, source);
    if (generated) {
      rmSync(generated.keyPath, { force: true });
      rmSync(generated.publicPath, { force: true });
    }
    rmSync(marker, { force: true });
    throw error;
  }
}
