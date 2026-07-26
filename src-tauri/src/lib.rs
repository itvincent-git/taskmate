mod git;
mod index;
mod markdown;
mod model;
mod workspace;

use git::GitStatus;
use model::{PropertyDefinition, SaveTaskInput, Task, TaskQuery, TaskSummary, WorkspaceSnapshot};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, RunEvent, State, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;
use workspace::Workspace;

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
fn git_history(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    with_workspace(state, |workspace| git::history(&workspace.root))
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
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            open_workspace,
            create_task,
            get_task,
            save_task,
            query_tasks,
            rebuild_index,
            delete_task,
            save_properties,
            check_external_change,
            git_status,
            git_initialize,
            git_set_remote,
            git_commit,
            git_push,
            git_pull,
            git_history
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
