# Your App

A neutral, reusable desktop application template built with Tauri 2, React 19, and TypeScript. It targets macOS and Windows and includes a small application shell, system theme support, English and Simplified Chinese, tray residence, launch-at-login, signed updates, diagnostics logs, tests, and release automation.

## Requirements

- Node.js 24.11.0
- pnpm 11.5.1
- Stable Rust and the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/)

## Create an application from this template

Create a repository from the GitHub template, clone it, install dependencies, commit the unchanged template, and run the one-time initializer from a clean worktree:

```sh
pnpm install
TAURI_SIGNING_PRIVATE_KEY_PASSWORD='a-long-secret' pnpm template:init -- \
  --name "My App" \
  --slug my-app \
  --identifier com.example.my-app \
  --repo owner/repo \
  --author "Name"
```

The initializer validates every value, updates the npm, Cargo, Tauri, HTML, UI, documentation, updater, and release identities, then generates an application-specific Tauri signing key. It refuses to run twice and rolls changes back if any step fails.

The private key is written to `.tauri-signing/<slug>.key`, which is ignored by Git. Back up the key and password securely; losing either prevents existing installations from accepting future updates. Configure these GitHub Actions secrets:

- `TAURI_SIGNING_PRIVATE_KEY`: the complete private key file contents
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: the password used during initialization

The public key is stored in `src-tauri/tauri.conf.json`. Never commit the private key.

## Development

```sh
pnpm dev:app
```

The browser-only UI is available with `pnpm dev`, although native IPC and plugins require the Tauri app. Updates are deliberately disabled before initialization and in development. Ordinary builds do not create signed updater artifacts.

## Quality checks

```sh
pnpm test
pnpm typecheck
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
```

## Release

With a clean worktree:

```sh
pnpm release patch
```

`major`, `minor`, and an explicit stable version such as `1.2.0` are also accepted. The command synchronizes npm, Cargo, and Tauri versions, creates a Conventional Commit release commit, and adds an annotated `app-vX.Y.Z` tag. Push the commit and tag to build macOS Intel, macOS Apple Silicon, and Windows x64 installers. The workflow publishes one complete `latest.json` updater manifest.

## Native behavior

Closing the main window hides it while the tray icon remains active. The tray menu can show the window or quit. Launch-at-login uses `--hidden`; clicking the Dock icon on macOS reopens the main window.

## License

MIT
