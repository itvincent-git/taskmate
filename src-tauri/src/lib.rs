mod git;
mod index;
mod markdown;
mod model;
mod workspace;

use git::GitStatus;
use model::{
    PropertyDefinition, PropertyOption, SaveTaskInput, Task, TaskQuery, TaskSearchResult,
    TaskSummary, WorkspaceSnapshot,
};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
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

#[derive(Deserialize)]
struct ReleaseVersion {
    version: String,
}

#[derive(Deserialize)]
struct GithubRelease {
    tag_name: String,
    body: Option<String>,
    published_at: Option<String>,
}

fn notes_from_changelog(changelog: &serde_json::Value, version: &str) -> Option<String> {
    match changelog.get(version)? {
        serde_json::Value::String(notes) => Some(notes.clone()),
        serde_json::Value::Object(notes) => serde_json::to_string(notes).ok(),
        _ => None,
    }
}

fn fetch_changelog_notes(client: &reqwest::blocking::Client, version: &str) -> Option<String> {
    let urls = [
        "https://raw.githubusercontent.com/itvincent-git/taskmate/main/changelog.json",
        "https://cdn.jsdelivr.net/gh/itvincent-git/taskmate@main/changelog.json",
    ];
    for url in urls {
        match client
            .get(url)
            .header("User-Agent", "taskmate")
            .header("Accept", "application/json")
            .send()
        {
            Ok(response) if response.status().is_success() => {
                match response.json::<serde_json::Value>() {
                    Ok(changelog) => {
                        if let Some(notes) = notes_from_changelog(&changelog, version) {
                            return Some(notes);
                        }
                    }
                    Err(error) => {
                        log::warn!("Unable to parse update changelog from {url}: {error}")
                    }
                }
            }
            Ok(response) => log::warn!(
                "Update changelog request to {url} returned {}",
                response.status()
            ),
            Err(error) => log::warn!("Update changelog request to {url} failed: {error}"),
        }
    }
    None
}

fn parse_version(version: &str) -> Option<(u32, u32, u32)> {
    let parts = version
        .trim_start_matches("app-v")
        .trim_start_matches('v')
        .split('.')
        .collect::<Vec<_>>();
    if parts.len() < 3 {
        return None;
    }

    let patch = parts[2]
        .chars()
        .take_while(|character| character.is_ascii_digit())
        .collect::<String>();
    Some((
        parts[0].parse().ok()?,
        parts[1].parse().ok()?,
        patch.parse().ok()?,
    ))
}

fn is_newer(current: &str, latest: &str) -> bool {
    matches!(
        (parse_version(current), parse_version(latest)),
        (Some(current), Some(latest)) if latest > current
    )
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
fn git_history(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    with_workspace(state, |workspace| git::history(&workspace.root))
}

#[tauri::command]
async fn check_for_updates(app: tauri::AppHandle) -> Result<Option<UpdateCheckResponse>, String> {
    let current_version = app.package_info().version.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(8))
            .build()
            .map_err(|error| format!("Unable to initialize update client: {error}"))?;

        let static_urls = [
            "https://raw.githubusercontent.com/itvincent-git/taskmate/main/src-tauri/tauri.conf.json",
            "https://cdn.jsdelivr.net/gh/itvincent-git/taskmate@main/src-tauri/tauri.conf.json",
        ];
        let mut latest_version = None;

        for url in static_urls {
            match client
                .get(url)
                .header("User-Agent", "taskmate")
                .header("Accept", "application/json")
                .send()
            {
                Ok(response) if response.status().is_success() => {
                    match response.json::<ReleaseVersion>() {
                        Ok(release) => {
                            latest_version = Some(release.version);
                            break;
                        }
                        Err(error) => log::warn!("Unable to parse update version from {url}: {error}"),
                    }
                }
                Ok(response) => log::warn!(
                    "Update version request to {url} returned {}",
                    response.status()
                ),
                Err(error) => log::warn!("Update version request to {url} failed: {error}"),
            }
        }

        if latest_version
            .as_deref()
            .is_some_and(|version| !is_newer(&current_version, version))
        {
            return Ok(None);
        }

        let api_url = "https://api.github.com/repos/itvincent-git/taskmate/releases/latest";
        match client
            .get(api_url)
            .header("User-Agent", "taskmate")
            .header("Accept", "application/vnd.github+json")
            .send()
        {
            Ok(response) if response.status().is_success() => {
                let release = response
                    .json::<GithubRelease>()
                    .map_err(|error| format!("Unable to parse update response: {error}"))?;
                let version = release
                    .tag_name
                    .trim_start_matches("app-v")
                    .trim_start_matches('v')
                    .to_string();
                if !is_newer(&current_version, &version) {
                    return Ok(None);
                }
                let body = release
                    .body
                    .filter(|body| !body.trim().is_empty())
                    .or_else(|| fetch_changelog_notes(&client, &version));
                Ok(Some(UpdateCheckResponse {
                    version,
                    current_version,
                    body,
                    date: release.published_at,
                }))
            }
            Ok(response) if latest_version.is_some() => {
                log::warn!(
                    "GitHub release request returned {}; using static version metadata",
                    response.status()
                );
                Ok(Some(UpdateCheckResponse {
                    body: fetch_changelog_notes(
                        &client,
                        latest_version.as_deref().expect("checked above"),
                    ),
                    version: latest_version.expect("checked above"),
                    current_version,
                    date: None,
                }))
            }
            Ok(response) => Err(format!(
                "Unable to check for updates: GitHub returned {}",
                response.status()
            )),
            Err(error) if latest_version.is_some() => {
                log::warn!("GitHub release request failed; using static version metadata: {error}");
                Ok(Some(UpdateCheckResponse {
                    body: fetch_changelog_notes(
                        &client,
                        latest_version.as_deref().expect("checked above"),
                    ),
                    version: latest_version.expect("checked above"),
                    current_version,
                    date: None,
                }))
            }
            Err(error) => Err(format!("Unable to check for updates: {error}")),
        }
    })
    .await
    .map_err(|error| format!("Update check task failed: {error}"))?
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
            restart_app
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

#[cfg(test)]
mod tests {
    use super::{is_newer, notes_from_changelog, parse_version};

    #[test]
    fn parses_release_versions() {
        assert_eq!(parse_version("0.6.0"), Some((0, 6, 0)));
        assert_eq!(parse_version("app-v1.2.3"), Some((1, 2, 3)));
        assert_eq!(parse_version("v2.0.1-beta.1"), Some((2, 0, 1)));
        assert_eq!(parse_version("invalid"), None);
    }

    #[test]
    fn compares_release_versions() {
        assert!(is_newer("0.5.0", "0.6.0"));
        assert!(is_newer("app-v0.9.9", "v1.0.0"));
        assert!(!is_newer("0.6.0", "0.6.0"));
        assert!(!is_newer("1.0.0", "0.9.9"));
        assert!(!is_newer("invalid", "1.0.0"));
    }

    #[test]
    fn reads_plain_and_localized_changelog_notes() {
        let changelog = serde_json::json!({
            "0.7.0": { "en": "- New details", "zh": "- 新增更新内容" },
            "0.6.0": "- Previous details"
        });
        let localized = notes_from_changelog(&changelog, "0.7.0").unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&localized).unwrap(),
            serde_json::json!({ "en": "- New details", "zh": "- 新增更新内容" })
        );
        assert_eq!(
            notes_from_changelog(&changelog, "0.6.0").as_deref(),
            Some("- Previous details")
        );
    }
}
