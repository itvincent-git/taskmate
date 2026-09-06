use crate::index::TaskIndex;
use crate::markdown::{hash_content, parse_task, serialize_task};
use crate::model::{
    Folder, MoveTasksResult, PropertyDefinition, PropertyOption, SaveTaskInput, Task, TaskQuery,
    TaskSearchResult, TaskSummary, WorkspaceSnapshot,
};
use base64::Engine;
use chrono::Utc;
use serde_yaml::Value;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use uuid::Uuid;

const PROPERTIES_FILE: &str = "properties.json";
static PROPERTIES_WRITE_LOCK: Mutex<()> = Mutex::new(());

pub struct Workspace {
    pub root: PathBuf,
}

impl Workspace {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    pub fn initialize(&self) -> Result<WorkspaceSnapshot, String> {
        for directory in ["tasks", "archive", "attachments", ".task-app/backups"] {
            fs::create_dir_all(self.root.join(directory)).map_err(to_string)?;
        }
        self.ensure_gitignore()?;
        let properties = self.load_or_create_properties()?;
        let index_path = self.root.join(".task-app/index.sqlite");
        let index_rebuilt = !index_path.exists();
        let index = TaskIndex::open(&index_path)?;
        self.incremental_scan(&index)?;
        let tasks = index.query(&TaskQuery::default(), &properties)?;
        Ok(WorkspaceSnapshot {
            path: self.root.to_string_lossy().to_string(),
            properties,
            tasks,
            index_rebuilt,
            folders: self.list_folders()?,
        })
    }

    #[cfg(test)]
    pub fn create_task(&self, title: Option<String>) -> Result<Task, String> {
        self.create_task_in(title, "")
    }

    pub fn create_task_in(&self, title: Option<String>, folder: &str) -> Result<Task, String> {
        self.ensure_initialized()?;
        let directory = self.folder_directory(false, folder)?;
        let now = Utc::now().to_rfc3339();
        let title = title
            .map(|title| title.trim().to_string())
            .filter(|title| !title.is_empty())
            .unwrap_or_else(|| "Untitled task".into());
        let id = Uuid::new_v4().to_string();
        let mut properties = BTreeMap::new();
        for definition in self.load_or_create_properties()? {
            if let Some(value) = definition.default_value {
                properties.insert(definition.key, value);
            }
        }
        let file_name = self.available_file_name(&directory, &title, &id, None);
        let mut task = Task {
            id,
            title,
            file_name,
            folder_path: folder.into(),
            body: String::new(),
            archived: false,
            created_at: now.clone(),
            updated_at: now,
            properties,
            content_hash: String::new(),
        };
        self.write_task(&mut task, None)?;
        Ok(task)
    }

    pub fn get_task(&self, id: &str) -> Result<Task, String> {
        let path = self.find_task_path(id)?;
        let text = fs::read_to_string(&path).map_err(to_string)?;
        self.read_task(&path, &text)
    }

    pub fn task_file_path(&self, id: &str) -> Result<PathBuf, String> {
        self.find_task_path(id)
    }

    pub fn save_task(&self, input: SaveTaskInput) -> Result<Task, String> {
        let current_path = self.find_task_path(&input.id)?;
        let current_text = fs::read_to_string(&current_path).map_err(to_string)?;
        let current = self.read_task(&current_path, &current_text)?;
        if let Some(expected) = input.expected_hash.as_ref() {
            if expected != &current.content_hash {
                return Err("EXTERNAL_CHANGE: The Markdown file changed outside Taskmate.".into());
            }
        }
        let mut task = Task {
            id: current.id,
            title: clean_title(&input.title, &current.title),
            file_name: current.file_name,
            folder_path: current.folder_path,
            body: input.body,
            archived: input.archived,
            created_at: current.created_at,
            updated_at: Utc::now().to_rfc3339(),
            properties: input.properties,
            content_hash: current.content_hash,
        };
        let directory = self.ensure_folder(task.archived, &task.folder_path)?;
        let desired_name =
            self.available_file_name(&directory, &task.title, &task.id, Some(&current_path));
        task.file_name = desired_name;
        self.write_task(&mut task, Some(&current_path))?;
        Ok(task)
    }

    pub fn query(&self, query: TaskQuery) -> Result<Vec<TaskSummary>, String> {
        let properties = self.load_or_create_properties()?;
        let index = TaskIndex::open(&self.root.join(".task-app/index.sqlite"))?;
        self.incremental_scan(&index)?;
        index.query(&query, &properties)
    }

    pub fn search(&self, search: &str) -> Result<Vec<TaskSearchResult>, String> {
        let index = TaskIndex::open(&self.root.join(".task-app/index.sqlite"))?;
        self.incremental_scan(&index)?;
        index.search(search)
    }

    pub fn rebuild_index(&self) -> Result<Vec<TaskSummary>, String> {
        let index = TaskIndex::open(&self.root.join(".task-app/index.sqlite"))?;
        index.clear()?;
        self.scan_all(&index)?;
        index.query(&TaskQuery::default(), &self.load_or_create_properties()?)
    }

    pub fn delete_task(&self, id: &str) -> Result<(), String> {
        let path = self.find_task_path(id)?;
        let task = self.read_task(&path, &fs::read_to_string(&path).map_err(to_string)?)?;
        if !task.archived {
            return Err("Only archived tasks can be permanently deleted.".into());
        }
        fs::remove_file(&path).map_err(to_string)?;
        TaskIndex::open(&self.root.join(".task-app/index.sqlite"))?.remove(id)
    }

    pub fn save_properties(
        &self,
        definitions: Vec<PropertyDefinition>,
    ) -> Result<Vec<PropertyDefinition>, String> {
        let _write_guard = PROPERTIES_WRITE_LOCK
            .lock()
            .map_err(|_| "Property storage is unavailable.".to_string())?;
        validate_definitions(&definitions)?;
        let path = self.root.join(".task-app").join(PROPERTIES_FILE);
        atomic_write(
            &path,
            serde_json::to_vec_pretty(&definitions)
                .map_err(to_string)?
                .as_slice(),
        )?;
        Ok(definitions)
    }

    pub fn create_property_option(
        &self,
        property_id: &str,
        label: &str,
    ) -> Result<PropertyOption, String> {
        let _write_guard = PROPERTIES_WRITE_LOCK
            .lock()
            .map_err(|_| "Property storage is unavailable.".to_string())?;
        let label = label.trim();
        if label.is_empty() {
            return Err("Tag labels cannot be empty.".into());
        }
        let mut definitions = self.load_or_create_properties()?;
        let definition = definitions
            .iter_mut()
            .find(|definition| definition.id == property_id)
            .ok_or_else(|| "Property not found.".to_string())?;
        if definition.property_type != "tags" {
            return Err("Options can only be created for tags properties.".into());
        }
        let folded_label = label.to_lowercase();
        if let Some(option) = definition.options.iter().find(|option| {
            option.id.to_lowercase() == folded_label || option.label.to_lowercase() == folded_label
        }) {
            return Ok(option.clone());
        }
        let option = PropertyOption {
            id: label.to_string(),
            label: label.to_string(),
            color: Some("#9C9C9C".into()),
            order: definition
                .options
                .iter()
                .map(|option| option.order)
                .max()
                .map_or(0, |order| order + 1),
        };
        definition.options.push(option.clone());
        validate_definitions(&definitions)?;
        let path = self.root.join(".task-app").join(PROPERTIES_FILE);
        atomic_write(
            &path,
            serde_json::to_vec_pretty(&definitions)
                .map_err(to_string)?
                .as_slice(),
        )?;
        Ok(option)
    }

    pub fn check_external_change(
        &self,
        id: &str,
        known_hash: &str,
    ) -> Result<Option<Task>, String> {
        let task = self.get_task(id)?;
        Ok((task.content_hash != known_hash).then_some(task))
    }

    pub fn read_attachment(&self, relative_path: &str) -> Result<String, String> {
        let relative = Path::new(relative_path)
            .strip_prefix("attachments")
            .unwrap_or_else(|_| Path::new(relative_path));
        if relative.is_absolute()
            || relative
                .components()
                .any(|component| matches!(component, std::path::Component::ParentDir))
        {
            return Err(
                "Attachment paths must stay inside the workspace attachments folder.".into(),
            );
        }
        let attachments = self
            .root
            .join("attachments")
            .canonicalize()
            .map_err(to_string)?;
        let path = attachments
            .join(relative)
            .canonicalize()
            .map_err(to_string)?;
        if !path.starts_with(&attachments) {
            return Err(
                "Attachment paths must stay inside the workspace attachments folder.".into(),
            );
        }
        let bytes = fs::read(&path).map_err(to_string)?;
        if bytes.len() > 20 * 1024 * 1024 {
            return Err("Live Preview images are limited to 20 MB.".into());
        }
        let mime = match path
            .extension()
            .and_then(|extension| extension.to_str())
            .unwrap_or_default()
            .to_lowercase()
            .as_str()
        {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "webp" => "image/webp",
            "svg" => "image/svg+xml",
            _ => return Err("Unsupported image attachment type.".into()),
        };
        Ok(format!(
            "data:{mime};base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        ))
    }

    fn ensure_initialized(&self) -> Result<(), String> {
        self.initialize().map(|_| ())
    }

    fn load_or_create_properties(&self) -> Result<Vec<PropertyDefinition>, String> {
        let path = self.root.join(".task-app").join(PROPERTIES_FILE);
        if path.exists() {
            return serde_json::from_slice(&fs::read(path).map_err(to_string)?).map_err(to_string);
        }
        let definitions = default_properties();
        fs::create_dir_all(self.root.join(".task-app")).map_err(to_string)?;
        atomic_write(
            &path,
            serde_json::to_vec_pretty(&definitions)
                .map_err(to_string)?
                .as_slice(),
        )?;
        Ok(definitions)
    }

    fn write_task(&self, task: &mut Task, previous_path: Option<&Path>) -> Result<(), String> {
        let directory = self.ensure_folder(task.archived, &task.folder_path)?;
        fs::create_dir_all(&directory).map_err(to_string)?;
        let target = directory.join(&task.file_name);
        let serialized = serialize_task(task)?;
        if previous_path == Some(target.as_path()) {
            atomic_write(&target, serialized.as_bytes())?;
        } else {
            let mut temporary = tempfile::NamedTempFile::new_in(&directory).map_err(to_string)?;
            temporary
                .write_all(serialized.as_bytes())
                .map_err(to_string)?;
            temporary.as_file().sync_all().map_err(to_string)?;
            temporary.persist_noclobber(&target).map_err(to_string)?;
        }
        task.content_hash = hash_content(serialized.as_bytes());
        if let Some(previous) = previous_path {
            if previous != target && previous.exists() {
                fs::remove_file(previous).map_err(to_string)?;
            }
        }
        let mtime = file_mtime(&target)?;
        TaskIndex::open(&self.root.join(".task-app/index.sqlite"))?.upsert(task, &target, mtime)
    }

    fn incremental_scan(&self, index: &TaskIndex) -> Result<(), String> {
        let old = index
            .indexed_state()?
            .into_iter()
            .map(|(id, path, mtime, hash)| (path, (id, mtime, hash)))
            .collect::<HashMap<_, _>>();
        let paths = self.markdown_paths()?;
        let existing: HashSet<_> = paths
            .iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect();
        for path in old.keys().filter(|path| !existing.contains(*path)) {
            index.remove_path(path)?;
        }
        for path in paths {
            let path_string = path.to_string_lossy().to_string();
            let mtime = file_mtime(&path)?;
            if old
                .get(&path_string)
                .is_some_and(|(_, known, _)| *known == mtime)
            {
                continue;
            }
            let text = fs::read_to_string(&path).map_err(to_string)?;
            let task = self.read_task(&path, &text)?;
            index.remove_path(&path_string)?;
            index.upsert(&task, &path, mtime)?;
        }
        Ok(())
    }

    fn scan_all(&self, index: &TaskIndex) -> Result<(), String> {
        for path in self.markdown_paths()? {
            let text = fs::read_to_string(&path).map_err(to_string)?;
            let task = self.read_task(&path, &text)?;
            index.upsert(&task, &path, file_mtime(&path)?)?;
        }
        Ok(())
    }

    fn markdown_paths(&self) -> Result<Vec<PathBuf>, String> {
        let mut paths = Vec::new();
        for archived in [false, true] {
            self.walk_region(archived, "", &mut paths, &mut Vec::new())?;
        }
        Ok(paths)
    }

    fn find_task_path(&self, id: &str) -> Result<PathBuf, String> {
        for path in self.markdown_paths()? {
            if let Ok(text) = fs::read_to_string(&path) {
                if parse_task(&path, &text).is_ok_and(|task| task.id == id) {
                    return Ok(path);
                }
            }
        }
        Err(format!("Task '{id}' was not found."))
    }

    fn available_file_name(
        &self,
        directory: &Path,
        title: &str,
        id: &str,
        current: Option<&Path>,
    ) -> String {
        let base = safe_file_stem(title);
        let preferred = format!("{base}.md");
        let preferred_path = directory.join(&preferred);
        if fs::symlink_metadata(&preferred_path).is_err()
            || current == Some(preferred_path.as_path())
        {
            return preferred;
        }
        let suffix = &id[..8.min(id.len())];
        for number in 0.. {
            let name = if number == 0 {
                format!("{base}-{suffix}.md")
            } else {
                format!("{base}-{suffix}-{number}.md")
            };
            let path = directory.join(&name);
            if fs::symlink_metadata(&path).is_err() || current == Some(path.as_path()) {
                return name;
            }
        }
        unreachable!()
    }

    fn region(&self, archived: bool) -> PathBuf {
        self.root.join(if archived { "archive" } else { "tasks" })
    }

    fn checked_folder(&self, archived: bool, folder: &str) -> Result<PathBuf, String> {
        let mut path = self.region(archived);
        if fs::symlink_metadata(&path)
            .map_err(to_string)?
            .file_type()
            .is_symlink()
        {
            return Err("Task regions cannot be symbolic links.".into());
        }
        if !folder.is_empty() {
            for name in folder.split('/') {
                validate_folder_name(name)?;
                path.push(name);
                if let Ok(metadata) = fs::symlink_metadata(&path) {
                    if metadata.file_type().is_symlink() || !metadata.is_dir() {
                        return Err("Folder paths must contain real directories.".into());
                    }
                }
            }
        }
        Ok(path)
    }

    fn folder_directory(&self, archived: bool, folder: &str) -> Result<PathBuf, String> {
        let path = self.checked_folder(archived, folder)?;
        if !path.is_dir() {
            return Err("Folder does not exist.".into());
        }
        Ok(path)
    }

    fn ensure_folder(&self, archived: bool, folder: &str) -> Result<PathBuf, String> {
        let path = self.checked_folder(archived, folder)?;
        fs::create_dir_all(&path).map_err(to_string)?;
        Ok(path)
    }

    fn read_task(&self, path: &Path, text: &str) -> Result<Task, String> {
        let mut task = parse_task(path, text)?;
        for archived in [false, true] {
            if let Ok(relative) = path.strip_prefix(self.region(archived)) {
                task.folder_path = relative
                    .parent()
                    .unwrap_or(Path::new(""))
                    .to_string_lossy()
                    .replace('\\', "/");
                task.archived = archived;
                return Ok(task);
            }
        }
        Err("Task is outside its region.".into())
    }

    fn walk_region(
        &self,
        archived: bool,
        folder: &str,
        files: &mut Vec<PathBuf>,
        folders: &mut Vec<Folder>,
    ) -> Result<(), String> {
        let directory = self.folder_directory(archived, folder)?;
        for entry in fs::read_dir(directory).map_err(to_string)? {
            let entry = entry.map_err(to_string)?;
            let kind = entry.file_type().map_err(to_string)?;
            if kind.is_symlink() {
                continue;
            }
            if kind.is_dir() {
                let name = entry.file_name().to_string_lossy().to_string();
                let child = if folder.is_empty() {
                    name
                } else {
                    format!("{folder}/{name}")
                };
                folders.push(Folder {
                    path: child.clone(),
                    archived,
                });
                self.walk_region(archived, &child, files, folders)?;
            } else if kind.is_file()
                && entry.path().extension().and_then(|s| s.to_str()) == Some("md")
            {
                files.push(entry.path());
            }
        }
        Ok(())
    }

    pub fn list_folders(&self) -> Result<Vec<Folder>, String> {
        let mut folders = Vec::new();
        for archived in [false, true] {
            self.walk_region(archived, "", &mut Vec::new(), &mut folders)?;
        }
        folders.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(folders)
    }

    pub fn create_folder(&self, archived: bool, parent: &str, name: &str) -> Result<(), String> {
        validate_folder_name(name)?;
        let target = self.folder_directory(archived, parent)?.join(name);
        fs::create_dir(target).map_err(to_string)
    }

    pub fn move_folder(
        &self,
        archived: bool,
        source: &str,
        parent: &str,
        name: &str,
    ) -> Result<(), String> {
        if source.is_empty() {
            return Err("Cannot move a task region.".into());
        }
        validate_folder_name(name)?;
        let from = self.folder_directory(archived, source)?;
        let target = self.folder_directory(archived, parent)?.join(name);
        if from == target {
            return Ok(());
        }
        if target.starts_with(&from) {
            return Err("Cannot move a folder into itself or a descendant.".into());
        }
        if fs::symlink_metadata(&target).is_ok() {
            return Err("A folder with that name already exists.".into());
        }
        fs::rename(from, target).map_err(to_string)
    }

    pub fn delete_folder(&self, archived: bool, folder: &str) -> Result<(), String> {
        if folder.is_empty() {
            return Err("Cannot delete a task region.".into());
        }
        let path = self.folder_directory(archived, folder)?;
        if fs::read_dir(&path).map_err(to_string)?.next().is_some() {
            return Err("Move the folder contents before deleting it.".into());
        }
        fs::remove_dir(path).map_err(to_string)
    }

    pub fn move_tasks(
        &self,
        ids: Vec<String>,
        archived: bool,
        folder: &str,
    ) -> Result<MoveTasksResult, String> {
        self.move_tasks_with(ids, archived, folder, move_task_file)
    }

    fn move_tasks_with(
        &self,
        ids: Vec<String>,
        archived: bool,
        folder: &str,
        mut move_file: impl FnMut(&Path, &Path) -> Result<(), String>,
    ) -> Result<MoveTasksResult, String> {
        let directory = self.folder_directory(archived, folder)?;
        let mut tasks = Vec::new();
        let mut unique = HashSet::new();
        for id in &ids {
            if !unique.insert(id) {
                return Err("Duplicate task ID.".into());
            }
            let task = self.get_task(id)?;
            if task.archived != archived {
                return Err("Tasks cannot move across active and archive regions.".into());
            }
            tasks.push(task);
        }
        let mut result = MoveTasksResult {
            completed: Vec::new(),
            remaining: ids,
            error: None,
        };
        for task in tasks {
            let operation = (|| {
                if task.folder_path == folder {
                    return Ok(());
                }
                let source = self.find_task_path(&task.id)?;
                let name = self.available_file_name(&directory, &task.title, &task.id, None);
                move_file(&source, &directory.join(name))?;
                Ok::<(), String>(())
            })();
            if let Err(error) = operation {
                result.error = Some(error);
                break;
            }
            result.completed.push(task.id);
            result.remaining.remove(0);
        }
        Ok(result)
    }

    fn ensure_gitignore(&self) -> Result<(), String> {
        let path = self.root.join(".gitignore");
        let required = [
            ".task-app/index.sqlite",
            ".task-app/index.sqlite-shm",
            ".task-app/index.sqlite-wal",
            ".task-app/git-sync.timestamp",
        ];
        let mut contents = fs::read_to_string(&path).unwrap_or_default();
        let mut changed = false;
        for entry in required {
            if !contents.lines().any(|line| line.trim() == entry) {
                if !contents.is_empty() && !contents.ends_with('\n') {
                    contents.push('\n');
                }
                contents.push_str(entry);
                contents.push('\n');
                changed = true;
            }
        }
        if changed {
            atomic_write(&path, contents.as_bytes())?;
        }
        Ok(())
    }
}

fn move_task_file(source: &Path, target: &Path) -> Result<(), String> {
    // create_new prevents overwrites and works on filesystems without hard links.
    let mut input = fs::File::open(source).map_err(to_string)?;
    let mut output = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(target)
        .map_err(to_string)?;
    let copied = io::copy(&mut input, &mut output).and_then(|_| output.sync_all());
    if let Err(error) = copied.and_then(|_| fs::remove_file(source)) {
        drop(output);
        let _ = fs::remove_file(target);
        return Err(error.to_string());
    }
    Ok(())
}

fn validate_folder_name(name: &str) -> Result<(), String> {
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.ends_with(['.', ' '])
        || name
            .chars()
            .any(|c| c.is_control() || "/\\:*?\"<>|".contains(c))
        || matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && matches!(stem.as_bytes()[3], b'1'..=b'9'))
    {
        return Err("Invalid cross-platform folder name.".into());
    }
    Ok(())
}

pub fn atomic_write(path: &Path, contents: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Invalid file path.".to_string())?;
    fs::create_dir_all(parent).map_err(to_string)?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(to_string)?;
    temporary.write_all(contents).map_err(to_string)?;
    temporary.as_file().sync_all().map_err(to_string)?;
    temporary.persist(path).map_err(to_string)?;
    Ok(())
}

pub fn safe_file_stem(title: &str) -> String {
    let cleaned = title
        .trim()
        .chars()
        .map(|character| match character {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0'..='\u{001f}' => '-',
            other => other,
        })
        .collect::<String>()
        .trim_matches(['.', ' '])
        .to_string();
    let cleaned = if cleaned.is_empty() {
        "untitled"
    } else {
        &cleaned
    };
    cleaned.chars().take(80).collect()
}

fn clean_title(title: &str, fallback: &str) -> String {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        fallback.into()
    } else {
        trimmed.into()
    }
}

fn file_mtime(path: &Path) -> Result<i64, String> {
    Ok(fs::metadata(path)
        .map_err(to_string)?
        .modified()
        .map_err(to_string)?
        .duration_since(UNIX_EPOCH)
        .map_err(to_string)?
        .as_millis() as i64)
}

fn validate_definitions(definitions: &[PropertyDefinition]) -> Result<(), String> {
    let mut keys = HashSet::new();
    for definition in definitions {
        if definition.key.trim().is_empty() {
            return Err("Property keys cannot be empty.".into());
        }
        if !keys.insert(definition.key.clone()) {
            return Err(format!("Duplicate property key '{}'.", definition.key));
        }
        if matches!(
            definition.key.as_str(),
            "id" | "title" | "archived" | "createdAt" | "updatedAt"
        ) {
            return Err(format!("'{}' is a reserved property key.", definition.key));
        }
    }
    Ok(())
}

fn option(id: &str, label: &str, color: &str, order: i64) -> PropertyOption {
    PropertyOption {
        id: id.into(),
        label: label.into(),
        color: Some(color.into()),
        order,
    }
}

fn default_properties() -> Vec<PropertyDefinition> {
    vec![
        property(
            "status",
            "Status",
            "select",
            true,
            true,
            true,
            true,
            Some("status"),
            vec![
                option("not-started", "Not started", "#718096", 0),
                option("in-progress", "In progress", "#3b82f6", 1),
                option("done", "Done", "#22a06b", 2),
                option("on-hold", "On hold", "#d97706", 3),
            ],
            Some(Value::String("not-started".into())),
            0,
        ),
        property(
            "priority",
            "Priority",
            "select",
            true,
            true,
            true,
            true,
            None,
            vec![
                option("high", "High", "#dc5245", 0),
                option("medium", "Medium", "#d97706", 1),
                option("low", "Low", "#22a06b", 2),
            ],
            Some(Value::String("medium".into())),
            1,
        ),
        property(
            "tags",
            "Tags",
            "tags",
            true,
            true,
            true,
            false,
            None,
            vec![],
            Some(Value::Sequence(vec![])),
            2,
        ),
        property(
            "startDate",
            "Start date",
            "date",
            true,
            false,
            true,
            true,
            None,
            vec![],
            None,
            3,
        ),
        property(
            "endDate",
            "Due date",
            "date",
            true,
            true,
            true,
            true,
            None,
            vec![],
            None,
            4,
        ),
    ]
}

#[allow(clippy::too_many_arguments)]
fn property(
    key: &str,
    name: &str,
    property_type: &str,
    detail: bool,
    card: bool,
    filter: bool,
    sort: bool,
    role: Option<&str>,
    options: Vec<PropertyOption>,
    default_value: Option<Value>,
    order: i64,
) -> PropertyDefinition {
    PropertyDefinition {
        id: Uuid::new_v4().to_string(),
        key: key.into(),
        name: name.into(),
        property_type: property_type.into(),
        show_in_detail: detail,
        show_in_card: card,
        enable_filter: filter,
        enable_sort: sort,
        required: false,
        default_value,
        options,
        order,
        role: role.map(str::to_string),
    }
}

fn to_string(error: impl ToString) -> String {
    error.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn save_input(task: Task, archived: bool) -> SaveTaskInput {
        SaveTaskInput {
            id: task.id,
            title: task.title,
            body: task.body,
            archived,
            created_at: task.created_at,
            properties: task.properties,
            expected_hash: Some(task.content_hash),
        }
    }

    #[test]
    fn nested_scan_empty_folders_queries_and_rebuild() {
        let temp = tempfile::tempdir().unwrap();
        let w = Workspace::new(temp.path().to_path_buf());
        w.initialize().unwrap();
        w.create_folder(false, "", "a").unwrap();
        w.create_folder(false, "a", "nested").unwrap();
        w.create_folder(false, "", "ab").unwrap();
        w.create_folder(false, "", "empty").unwrap();
        w.create_task_in(Some("Nested".into()), "a/nested").unwrap();
        w.create_task_in(Some("Other".into()), "ab").unwrap();
        w.create_task(None).unwrap();
        let query = TaskQuery {
            folder_path: Some("a".into()),
            ..Default::default()
        };
        assert_eq!(w.query(query.clone()).unwrap().len(), 1);
        assert_eq!(
            w.query(TaskQuery {
                folder_path: Some("".into()),
                ..Default::default()
            })
            .unwrap()
            .len(),
            1
        );
        assert_eq!(w.list_folders().unwrap().len(), 4);
        w.rebuild_index().unwrap();
        assert_eq!(w.query(query).unwrap()[0].folder_path, "a/nested");
    }

    #[test]
    fn moves_keep_uuid_content_and_stale_saves_keep_current_location() {
        let temp = tempfile::tempdir().unwrap();
        let w = Workspace::new(temp.path().to_path_buf());
        let task = w.create_task(Some("Task".into())).unwrap();
        w.create_folder(false, "", "a").unwrap();
        let result = w.move_tasks(vec![task.id.clone()], false, "a").unwrap();
        assert!(result.error.is_none());
        assert_eq!(
            w.get_task(&task.id).unwrap().content_hash,
            task.content_hash
        );
        let saved = w.save_task(save_input(task, false)).unwrap();
        assert_eq!(saved.folder_path, "a");
        let archived = w.save_task(save_input(saved, true)).unwrap();
        assert!(temp.path().join("archive/a/Task.md").exists());
        w.move_folder(false, "a", "", "renamed").unwrap();
        let restored = w.save_task(save_input(archived, false)).unwrap();
        assert_eq!(restored.folder_path, "a");
        assert!(temp.path().join("tasks/a/Task.md").exists());
    }

    #[test]
    fn external_directory_and_file_moves_survive_incremental_cleanup() {
        let temp = tempfile::tempdir().unwrap();
        let w = Workspace::new(temp.path().to_path_buf());
        let task = w.create_task(Some("Task".into())).unwrap();
        w.create_folder(false, "", "a").unwrap();
        fs::rename(
            temp.path().join("tasks/Task.md"),
            temp.path().join("tasks/a/Task.md"),
        )
        .unwrap();
        assert_eq!(w.query(Default::default()).unwrap()[0].id, task.id);
        w.move_folder(false, "a", "", "b").unwrap();
        assert_eq!(w.query(Default::default()).unwrap()[0].folder_path, "b");
        assert_eq!(
            w.get_task(&task.id).unwrap().content_hash,
            task.content_hash
        );
        w.rebuild_index().unwrap();
        assert_eq!(w.search("Task").unwrap()[0].folder_path, "b");
    }

    #[test]
    fn rejects_unsafe_folders_descendants_and_nonempty_delete() {
        let temp = tempfile::tempdir().unwrap();
        let w = Workspace::new(temp.path().to_path_buf());
        w.initialize().unwrap();
        for name in [
            "..",
            "../escape",
            "a/b",
            "CON",
            "LPT1.txt",
            "trailing.",
            "trailing ",
            "a:b",
        ] {
            assert!(w.create_folder(false, "", name).is_err(), "{name}");
        }
        w.create_folder(false, "", "a").unwrap();
        w.create_folder(false, "a", "child").unwrap();
        assert!(w.move_folder(false, "a", "a/child", "a").is_err());
        assert!(w.create_folder(false, "", "a").is_err());
        assert!(w.delete_folder(false, "a").is_err());
        assert!(w.create_task_in(None, "../escape").is_err());
        w.delete_folder(false, "a/child").unwrap();
        w.delete_folder(false, "a").unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn skips_symlinks_and_rejects_writes_through_them() {
        let temp = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let w = Workspace::new(temp.path().to_path_buf());
        w.initialize().unwrap();
        std::os::unix::fs::symlink(outside.path(), temp.path().join("tasks/link")).unwrap();
        assert!(w.list_folders().unwrap().is_empty());
        assert!(w.create_task_in(None, "link").is_err());
        assert!(w.create_folder(false, "link", "escape").is_err());
    }

    #[test]
    fn move_conflicts_never_overwrite_and_batch_reports_partial_failure() {
        let temp = tempfile::tempdir().unwrap();
        let w = Workspace::new(temp.path().to_path_buf());
        let task = w.create_task(Some("Same".into())).unwrap();
        w.create_folder(false, "", "target").unwrap();
        w.create_task_in(Some("Same".into()), "target").unwrap();
        let suffix_path = temp
            .path()
            .join(format!("tasks/target/Same-{}.md", &task.id[..8]));
        fs::write(&suffix_path, "do not overwrite").unwrap();
        let result = w
            .move_tasks(vec![task.id.clone()], false, "target")
            .unwrap();
        assert!(result.error.is_none());
        assert_eq!(fs::read_to_string(suffix_path).unwrap(), "do not overwrite");
        assert_eq!(
            w.get_task(&task.id).unwrap().file_name,
            format!("Same-{}-1.md", &task.id[..8])
        );
        // Remove the deliberately non-task fixture before scanning again.
        fs::remove_file(
            temp.path()
                .join(format!("tasks/target/Same-{}.md", &task.id[..8])),
        )
        .unwrap();
        let first = w.create_task(Some("First".into())).unwrap();
        let second = w.create_task(Some("Second".into())).unwrap();
        let mut count = 0;
        let result = w
            .move_tasks_with(
                vec![first.id.clone(), second.id.clone()],
                false,
                "target",
                |source, target| {
                    count += 1;
                    if count == 2 {
                        return Err("Injected filesystem failure".into());
                    }
                    move_task_file(source, target)
                },
            )
            .unwrap();
        assert_eq!(result.completed, vec![first.id]);
        assert_eq!(result.remaining, vec![second.id]);
        assert!(result.error.is_some());
        assert_eq!(w.query(Default::default()).unwrap().len(), 4);
    }

    #[test]
    fn default_properties_match_builtin_schema() {
        assert_eq!(
            default_properties()
                .iter()
                .map(|definition| definition.key.as_str())
                .collect::<Vec<_>>(),
            vec!["status", "priority", "tags", "startDate", "endDate"]
        );
    }

    #[test]
    fn sanitizes_unsafe_file_names() {
        assert_eq!(
            safe_file_stem("  bad:/\\*?\"<>| name. "),
            "bad--------- name"
        );
        assert_eq!(safe_file_stem("..."), "untitled");
    }

    #[test]
    fn creates_tag_options_idempotently_and_persists_them() {
        let temporary = tempfile::tempdir().unwrap();
        let workspace = Workspace::new(temporary.path().to_path_buf());
        let snapshot = workspace.initialize().unwrap();
        let tags = snapshot
            .properties
            .iter()
            .find(|definition| definition.property_type == "tags")
            .unwrap();
        let created = workspace
            .create_property_option(&tags.id, "  Release, 1  ")
            .unwrap();
        assert_eq!(created.id, "Release, 1");
        assert_eq!(created.label, "Release, 1");
        assert_eq!(created.color.as_deref(), Some("#9C9C9C"));
        assert_eq!(
            workspace
                .create_property_option(&tags.id, "release, 1")
                .unwrap()
                .id,
            created.id
        );
        let reopened = workspace.initialize().unwrap();
        let options = &reopened
            .properties
            .iter()
            .find(|definition| definition.id == tags.id)
            .unwrap()
            .options;
        assert_eq!(options.len(), 1);
        assert_eq!(options[0].id, created.id);
    }

    #[test]
    fn rejects_invalid_property_option_creation() {
        let temporary = tempfile::tempdir().unwrap();
        let workspace = Workspace::new(temporary.path().to_path_buf());
        let snapshot = workspace.initialize().unwrap();
        let select = snapshot
            .properties
            .iter()
            .find(|definition| definition.property_type == "select")
            .unwrap();
        assert!(workspace
            .create_property_option(&select.id, "Later")
            .is_err());
        assert!(workspace
            .create_property_option("missing", "Later")
            .is_err());
        assert!(workspace
            .create_property_option(select.id.as_str(), "  ")
            .is_err());
    }

    #[test]
    fn creates_updates_archives_and_rebuilds() {
        let temporary = tempfile::tempdir().unwrap();
        let workspace = Workspace::new(temporary.path().to_path_buf());
        workspace.initialize().unwrap();
        let created = workspace.create_task(Some("First".into())).unwrap();
        assert!(temporary.path().join("tasks/First.md").exists());
        let saved = workspace
            .save_task(SaveTaskInput {
                id: created.id.clone(),
                title: "Renamed".into(),
                body: "# Hello".into(),
                archived: true,
                created_at: created.created_at,
                properties: created.properties,
                expected_hash: Some(created.content_hash),
            })
            .unwrap();
        assert!(temporary.path().join("archive/Renamed.md").exists());
        assert!(!temporary.path().join("tasks/First.md").exists());
        fs::remove_file(temporary.path().join(".task-app/index.sqlite")).unwrap();
        let rebuilt = workspace.initialize().unwrap();
        assert!(rebuilt.index_rebuilt);
        let archived = workspace
            .query(TaskQuery {
                archived: true,
                ..TaskQuery::default()
            })
            .unwrap();
        assert_eq!(archived[0].id, saved.id);
    }

    #[test]
    fn restores_the_existing_title_when_saving_a_blank_title() {
        let temporary = tempfile::tempdir().unwrap();
        let workspace = Workspace::new(temporary.path().to_path_buf());
        workspace.initialize().unwrap();
        let created = workspace.create_task(Some("Original title".into())).unwrap();
        let saved = workspace
            .save_task(SaveTaskInput {
                id: created.id,
                title: "   ".into(),
                body: created.body,
                archived: created.archived,
                created_at: created.created_at,
                properties: created.properties,
                expected_hash: Some(created.content_hash),
            })
            .unwrap();

        assert_eq!(saved.title, "Original title");
        assert_eq!(saved.file_name, "Original title.md");
        assert!(temporary.path().join("tasks/Original title.md").exists());
    }

    #[test]
    fn rejects_delete_until_archived() {
        let temporary = tempfile::tempdir().unwrap();
        let workspace = Workspace::new(temporary.path().to_path_buf());
        let task = workspace.create_task(None).unwrap();
        assert!(workspace.delete_task(&task.id).is_err());
    }

    #[test]
    fn permanently_deletes_an_archived_task_and_its_index_row() {
        let temporary = tempfile::tempdir().unwrap();
        let workspace = Workspace::new(temporary.path().to_path_buf());
        let task = workspace.create_task(Some("Delete me".into())).unwrap();
        let archived = workspace
            .save_task(SaveTaskInput {
                id: task.id.clone(),
                title: task.title,
                body: task.body,
                archived: true,
                created_at: task.created_at,
                properties: task.properties,
                expected_hash: Some(task.content_hash),
            })
            .unwrap();
        workspace.delete_task(&archived.id).unwrap();
        assert!(workspace.get_task(&archived.id).is_err());
        assert!(workspace
            .query(TaskQuery {
                archived: true,
                ..TaskQuery::default()
            })
            .unwrap()
            .is_empty());
    }

    #[test]
    fn resolves_file_name_conflicts_without_changing_ids() {
        let temporary = tempfile::tempdir().unwrap();
        let workspace = Workspace::new(temporary.path().to_path_buf());
        let first = workspace.create_task(Some("Duplicate".into())).unwrap();
        let second = workspace.create_task(Some("Duplicate".into())).unwrap();
        assert_eq!(first.file_name, "Duplicate.md");
        assert!(second.file_name.starts_with("Duplicate-"));
        assert_ne!(first.id, second.id);
        assert_eq!(workspace.get_task(&first.id).unwrap().id, first.id);
        assert_eq!(workspace.get_task(&second.id).unwrap().id, second.id);
    }

    #[test]
    fn attachment_reader_is_confined_to_workspace_images() {
        let temporary = tempfile::tempdir().unwrap();
        let workspace = Workspace::new(temporary.path().to_path_buf());
        workspace.initialize().unwrap();
        fs::write(
            temporary.path().join("attachments/pixel.png"),
            [137, 80, 78, 71],
        )
        .unwrap();
        assert!(workspace
            .read_attachment("attachments/pixel.png")
            .unwrap()
            .starts_with("data:image/png;base64,"));
        assert!(workspace.read_attachment("../outside.png").is_err());
        assert!(workspace.read_attachment("/etc/passwd").is_err());
    }
}
