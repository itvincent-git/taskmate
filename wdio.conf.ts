import { createTauriCapabilities } from "@wdio/tauri-service";

const binaryName = process.platform === "win32" ? "taskmate.exe" : "taskmate";
const appBinaryPath = `./src-tauri/target/debug/${binaryName}`;

export const config: WebdriverIO.Config = {
  runner: "local",
  tsConfigPath: "./tsconfig.e2e.json",
  specs: ["./e2e/**/*.spec.ts"],
  maxInstances: 1,
  capabilities: [createTauriCapabilities(appBinaryPath)],
  services: [
    [
      "@wdio/tauri-service",
      {
        appBinaryPath,
        driverProvider: "embedded",
      },
    ],
  ],
  framework: "mocha",
  reporters: ["spec"],
  logLevel: "warn",
  waitforTimeout: 10_000,
  connectionRetryTimeout: 90_000,
  connectionRetryCount: 3,
  mochaOpts: {
    ui: "bdd",
    timeout: 60_000,
  },
};
