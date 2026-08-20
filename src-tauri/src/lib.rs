mod git;
mod index;
mod markdown;
mod model;
mod workspace;

use git::{GitHistoryEntry, GitStatus};
use model::{
    PropertyDefinition, PropertyOption, SaveTaskInput, Task, TaskQuery, TaskSearchResult,
    TaskSummary, WorkspaceSnapshot,
};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::path::PathBuf;
use std::process::Command;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex,
};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, RunEvent, State, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_updater::UpdaterExt;
use workspace::Workspace;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateCheckResponse {
    version: String,
    current_version: String,
    body: Option<String>,
    date: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateDownloadProgress {
    downloaded: u64,
    total: Option<u64>,
    finished: bool,
}

struct AppState {
    workspace: Mutex<Option<PathBuf>>,
    watcher: Mutex<Option<RecommendedWatcher>>,
}

fn with_workspace<T>(
    state: State<'_, AppState>,
    operation: impl FnOnce(Workspace) -> Result<T, String>,
) -> Result<T, String> {
    let root = state
        .workspace
        .lock()
        .map_err(|_| "Workspace state is unavailable.".to_string())?
        .clone()
        .ok_or_else(|| "Open a workspace first.".to_string())?;
    operation(Workspace::new(root))
}

#[tauri::command]
fn open_workspace(
    path: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<WorkspaceSnapshot, String> {
    let root = PathBuf::from(path);
    if root.as_os_str().is_empty() {
        return Err("Workspace path cannot be empty.".into());
    }
    let snapshot = Workspace::new(root.clone()).initialize()?;
    *state
        .workspace
        .lock()
        .map_err(|_| "Workspace state is unavailable.".to_string())? = Some(root);
    let event_app = app.clone();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        if let Ok(event) = event {
            let paths = event
                .paths
                .into_iter()
                .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("md"))
                .map(|path| path.to_string_lossy().to_string())
                .collect::<Vec<_>>();
            if !paths.is_empty() {
                let _ = event_app.emit("workspace-file-change", paths);
            }
        }
    })
    .map_err(|error| format!("Unable to watch workspace: {error}"))?;
    watcher
        .watch(
            &PathBuf::from(&snapshot.path).join("tasks"),
            RecursiveMode::NonRecursive,
        )
        .map_err(|error| format!("Unable to watch active tasks: {error}"))?;
    watcher
        .watch(
            &PathBuf::from(&snapshot.path).join("archive"),
            RecursiveMode::NonRecursive,
        )
        .map_err(|error| format!("Unable to watch archived tasks: {error}"))?;
    *state
        .watcher
        .lock()
        .map_err(|_| "Workspace watcher is unavailable.".to_string())? = Some(watcher);
    Ok(snapshot)
}

#[tauri::command]
fn create_task(title: Option<String>, state: State<'_, AppState>) -> Result<Task, String> {
    with_workspace(state, |workspace| workspace.create_task(title))
}

#[tauri::command]
fn get_task(id: String, state: State<'_, AppState>) -> Result<Task, String> {
    with_workspace(state, |workspace| workspace.get_task(&id))
}

#[tauri::command]
fn save_task(input: SaveTaskInput, state: State<'_, AppState>) -> Result<Task, String> {
    with_workspace(state, |workspace| workspace.save_task(input))
}

#[tauri::command]
fn query_tasks(query: TaskQuery, state: State<'_, AppState>) -> Result<Vec<TaskSummary>, String> {
    with_workspace(state, |workspace| workspace.query(query))
}

#[tauri::command]
fn search_tasks(
    search: String,
    state: State<'_, AppState>,
) -> Result<Vec<TaskSearchResult>, String> {
    with_workspace(state, |workspace| workspace.search(&search))
}

#[tauri::command]
fn rebuild_index(state: State<'_, AppState>) -> Result<Vec<TaskSummary>, String> {
    with_workspace(state, |workspace| workspace.rebuild_index())
}

#[tauri::command]
fn delete_task(id: String, state: State<'_, AppState>) -> Result<(), String> {
    with_workspace(state, |workspace| workspace.delete_task(&id))
}

#[tauri::command]
fn save_properties(
    definitions: Vec<PropertyDefinition>,
    state: State<'_, AppState>,
) -> Result<Vec<PropertyDefinition>, String> {
    with_workspace(state, |workspace| workspace.save_properties(definitions))
}

#[tauri::command]
fn create_property_option(
    property_id: String,
    label: String,
    state: State<'_, AppState>,
) -> Result<PropertyOption, String> {
    with_workspace(state, |workspace| {
        workspace.create_property_option(&property_id, &label)
    })
}

#[tauri::command]
fn check_external_change(
    id: String,
    known_hash: String,
    state: State<'_, AppState>,
) -> Result<Option<Task>, String> {
    with_workspace(state, |workspace| {
        workspace.check_external_change(&id, &known_hash)
    })
}

#[tauri::command]
fn read_attachment(path: String, state: State<'_, AppState>) -> Result<String, String> {
    with_workspace(state, |workspace| workspace.read_attachment(&path))
}

#[tauri::command]
fn git_status(state: State<'_, AppState>) -> Result<GitStatus, String> {
    with_workspace(state, |workspace| git::status(&workspace.root))
}

#[tauri::command]
fn git_initialize(state: State<'_, AppState>) -> Result<GitStatus, String> {
    with_workspace(state, |workspace| git::initialize(&workspace.root))
}

#[tauri::command]
fn git_set_remote(url: String, state: State<'_, AppState>) -> Result<GitStatus, String> {
    with_workspace(state, |workspace| git::set_remote(&workspace.root, &url))
}

#[tauri::command]
fn git_commit(message: String, state: State<'_, AppState>) -> Result<GitStatus, String> {
    with_workspace(state, |workspace| git::commit(&workspace.root, &message))
}

#[tauri::command]
fn git_push(state: State<'_, AppState>) -> Result<GitStatus, String> {
    with_workspace(state, |workspace| git::push(&workspace.root))
}

#[tauri::command]
fn git_pull(state: State<'_, AppState>) -> Result<GitStatus, String> {
    with_workspace(state, |workspace| git::pull(&workspace.root))
}

#[tauri::command]
fn git_history(state: State<'_, AppState>) -> Result<Vec<GitHistoryEntry>, String> {
    with_workspace(state, |workspace| git::history(&workspace.root))
}

#[tauri::command]
async fn check_for_updates(app: tauri::AppHandle) -> Result<Option<UpdateCheckResponse>, String> {
    let current_version = app.package_info().version.to_string();
    let update = app
        .updater()
        .map_err(|error| format!("Unable to initialize updater: {error}"))?
        .check()
        .await
        .map_err(|error| format!("Unable to check for updates: {error}"))?;

    Ok(update.map(|update| UpdateCheckResponse {
        version: update.version,
        current_version,
        body: update.body,
        date: update.date.map(|date| date.to_string()),
    }))
}

#[tauri::command]
async fn download_and_install_update(app: tauri::AppHandle) -> Result<String, String> {
    let update = app
        .updater()
        .map_err(|error| format!("Unable to initialize updater: {error}"))?
        .check()
        .await
        .map_err(|error| format!("Unable to check for updates: {error}"))?
        .ok_or_else(|| "No update is available.".to_string())?;
    let version = update.version.clone();
    let downloaded = Arc::new(AtomicU64::new(0));
    let finished_downloaded = Arc::clone(&downloaded);
    let progress_app = app.clone();

    update
        .download_and_install(
            move |chunk_length, content_length| {
                let downloaded = downloaded
                    .fetch_add(chunk_length as u64, Ordering::Relaxed)
                    .saturating_add(chunk_length as u64);
                let _ = progress_app.emit(
                    "update-download-progress",
                    UpdateDownloadProgress {
                        downloaded,
                        total: content_length,
                        finished: false,
                    },
                );
            },
            move || {
                let downloaded = finished_downloaded.load(Ordering::Relaxed);
                let _ = app.emit(
                    "update-download-progress",
                    UpdateDownloadProgress {
                        downloaded,
                        total: Some(downloaded),
                        finished: true,
                    },
                );
            },
        )
        .await
        .map_err(|error| format!("Unable to download and install update: {error}"))?;

    log::info!("Update {version} installed and ready to restart.");
    Ok(version)
}

#[tauri::command]
fn restart_app(app: tauri::AppHandle) {
    app.request_restart();
}

#[tauri::command]
async fn pick_system_font(
    current_font: Option<String>,
    title: String,
    prompt: String,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        pick_system_font_blocking(current_font.as_deref(), &title, &prompt)
    })
    .await
    .map_err(|error| format!("Unable to open the system font picker: {error}"))?
}

#[cfg(target_os = "macos")]
fn pick_system_font_blocking(
    current_font: Option<&str>,
    title: &str,
    prompt: &str,
) -> Result<Option<String>, String> {
    const SCRIPT: &str = r#"
function run(argv) {
  ObjC.import('AppKit');
  const app = Application.currentApplication();
  app.includeStandardAdditions = true;
  const fonts = ObjC.deepUnwrap($.NSFontManager.sharedFontManager.availableFontFamilies)
    .map(String).sort((left, right) => left.localeCompare(right));
  const options = {
    withTitle: argv[1],
    withPrompt: argv[2],
    multipleSelectionsAllowed: false,
    emptySelectionAllowed: false
  };
  if (argv[0] && fonts.includes(argv[0])) options.defaultItems = [argv[0]];
  const selected = app.chooseFromList(fonts, options);
  return selected === false ? '' : selected[0];
}
"#;
    command_font_picker(Command::new("/usr/bin/osascript").args([
        "-l",
        "JavaScript",
        "-e",
        SCRIPT,
        "--",
        current_font.unwrap_or(""),
        title,
        prompt,
    ]))
}

#[cfg(target_os = "windows")]
fn pick_system_font_blocking(
    current_font: Option<&str>,
    _title: &str,
    _prompt: &str,
) -> Result<Option<String>, String> {
    const SCRIPT: &str = r#"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$dialog = New-Object System.Windows.Forms.FontDialog
$dialog.ShowEffects = $false
if ($args[0]) {
  try { $dialog.Font = New-Object System.Drawing.Font($args[0], 12) } catch {}
}
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::Write($dialog.Font.FontFamily.Name)
}
$dialog.Dispose()
"#;
    command_font_picker(Command::new("powershell.exe").args([
        "-NoProfile",
        "-STA",
        "-Command",
        SCRIPT,
        current_font.unwrap_or(""),
    ]))
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn pick_system_font_blocking(
    _current_font: Option<&str>,
    _title: &str,
    _prompt: &str,
) -> Result<Option<String>, String> {
    Err("The system font picker is not supported on this platform.".into())
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn command_font_picker(command: &mut Command) -> Result<Option<String>, String> {
    let output = command
        .output()
        .map_err(|error| format!("Unable to start the system font picker: {error}"))?;
    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if message.is_empty() {
            "The system font picker closed unexpectedly.".into()
        } else {
            message
        });
    }
    let font = String::from_utf8(output.stdout)
        .map_err(|_| "The system font picker returned an invalid font name.".to_string())?
        .trim()
        .to_string();
    Ok((!font.is_empty()).then_some(font))
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub fn run() {
    let app = tauri::Builder::default()
        .manage(AppState {
            workspace: Mutex::new(None),
            watcher: Mutex::new(None),
        })
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            open_workspace,
            create_task,
            get_task,
            save_task,
            query_tasks,
            search_tasks,
            rebuild_index,
            delete_task,
            save_properties,
            create_property_option,
            check_external_change,
            read_attachment,
            git_status,
            git_initialize,
            git_set_remote,
            git_commit,
            git_push,
            git_pull,
            git_history,
            check_for_updates,
            download_and_install_update,
            restart_app,
            pick_system_font
        ])
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "Show Taskmate", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let tray_icon =
                tauri::image::Image::from_bytes(include_bytes!("../icons/tray-icon.png"))?;
            TrayIconBuilder::with_id("main-tray")
                .menu(&menu)
                .tooltip("Taskmate")
                .icon(tray_icon)
                .icon_as_template(cfg!(target_os = "macos"))
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if matches!(
                        event,
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            ..
                        }
                    ) {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;
            if std::env::args().any(|argument| argument == "--hidden") {
                if let Some(window) = app.get_webview_window("main") {
                    window.hide()?;
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build Tauri application");

    app.run(|app, event| match event {
        RunEvent::WindowEvent {
            label,
            event: WindowEvent::CloseRequested { api, .. },
            ..
        } if label == "main" => {
            api.prevent_close();
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.hide();
            }
        }
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => show_main_window(app),
        _ => {}
    });
}
