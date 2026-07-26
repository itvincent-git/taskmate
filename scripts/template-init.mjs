#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { initializeTemplate, parseArguments } from "./template-init-lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

try {
  const options = parseArguments(process.argv.slice(2));
  const result = initializeTemplate({ root, options });
  console.log(`Initialized ${options.name} (${options.identifier}).`);
  console.log(`Private signing key: ${result.keyPath}`);
  console.log("Back up this private key and its password securely. It cannot be recovered.");
  console.log("Add the private key contents to GitHub secret TAURI_SIGNING_PRIVATE_KEY.");
  console.log("Add the password to GitHub secret TAURI_SIGNING_PRIVATE_KEY_PASSWORD.");
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
