use crate::markdown::hash_content;
use crate::model::{SavedViewsFile, SavedViewsSnapshot, SavedWorkView};
use crate::workspace::{atomic_write, Workspace};
use std::{collections::HashSet, fs, io::ErrorKind, sync::Mutex};

static VIEWS_WRITE_LOCK: Mutex<()> = Mutex::new(());

fn validate(views: &[SavedWorkView]) -> Result<(), String> {
    let mut ids = HashSet::new();
    let mut names = HashSet::new();
    for view in views {
        if view.id.trim().is_empty() || !ids.insert(&view.id) {
            return Err("Invalid or duplicate view ID.".into());
        }
        if view.name.trim().is_empty() || view.name != view.name.trim() || !names.insert(&view.name)
        {
            return Err("View names must be nonempty, trimmed and unique.".into());
        }
        if view.sorts.iter().any(|sort| {
            !matches!(sort.direction.as_str(), "asc" | "desc")
                || !matches!(sort.nulls.as_str(), "first" | "last")
        }) {
            return Err("Invalid saved view sort.".into());
        }
    }
    Ok(())
}

impl Workspace {
    pub fn load_views(&self) -> Result<SavedViewsSnapshot, String> {
        let bytes = match fs::read(self.root.join(".task-app/views.json")) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == ErrorKind::NotFound => {
                // Windows can report NotFound when .task-app is a regular file.
                match fs::metadata(self.root.join(".task-app")) {
                    Ok(metadata) if !metadata.is_dir() => {
                        return Err(
                            "Unable to read saved views: .task-app is not a directory.".into()
                        );
                    }
                    Err(error) if error.kind() != ErrorKind::NotFound => {
                        return Err(format!("Unable to read saved views: {error}"));
                    }
                    _ => {}
                }
                return Ok(SavedViewsSnapshot {
                    views: vec![],
                    content_hash: None,
                });
            }
            Err(error) => return Err(format!("Unable to read saved views: {error}")),
        };
        let file: SavedViewsFile = serde_json::from_slice(&bytes)
            .map_err(|error| format!("Invalid saved views file: {error}"))?;
        if file.version != 1 {
            return Err("Unsupported saved views file version.".into());
        }
        validate(&file.views)?;
        Ok(SavedViewsSnapshot {
            views: file.views,
            content_hash: Some(hash_content(&bytes)),
        })
    }

    pub fn save_views(
        &self,
        mut views: Vec<SavedWorkView>,
        expected_hash: Option<String>,
    ) -> Result<SavedViewsSnapshot, String> {
        let _guard = VIEWS_WRITE_LOCK
            .lock()
            .map_err(|_| "Saved views lock is unavailable.")?;
        for view in &mut views {
            view.name = view.name.trim().to_string();
        }
        validate(&views)?;
        // Parse the existing file before writing, even if the caller knows its hash.
        let current = self.load_views()?;
        if current.content_hash != expected_hash {
            return Err(
                "VIEWS_CONFLICT: Saved views changed on disk. Reload before saving.".into(),
            );
        }
        let bytes = serde_json::to_vec_pretty(&SavedViewsFile {
            version: 1,
            views: views.clone(),
        })
        .map_err(|error| error.to_string())?;
        atomic_write(&self.root.join(".task-app/views.json"), &bytes)?;
        Ok(SavedViewsSnapshot {
            views,
            content_hash: Some(hash_content(&bytes)),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn view(name: &str) -> SavedWorkView {
        SavedWorkView {
            id: "view-1".into(),
            name: name.into(),
            filters: vec![],
            sorts: vec![],
            folder_path: Some("".into()),
            archived: true,
        }
    }

    #[test]
    fn missing_file_is_lazy_and_saves_are_atomic_and_versioned() {
        let dir = tempfile::tempdir().unwrap();
        let workspace = Workspace::new(dir.path().into());
        assert!(workspace.load_views().unwrap().views.is_empty());
        assert!(!dir.path().join(".task-app/views.json").exists());
        fs::create_dir(dir.path().join(".task-app")).unwrap();
        let missing = workspace.load_views().unwrap();
        assert!(missing.views.is_empty());
        assert_eq!(missing.content_hash, None);
        assert_eq!(
            fs::read_dir(dir.path().join(".task-app")).unwrap().count(),
            0
        );
        let saved = workspace
            .save_views(vec![view("  Archive  ")], None)
            .unwrap();
        let loaded = workspace.load_views().unwrap();
        assert_eq!(loaded.views[0].name, "Archive");
        assert_eq!(loaded.views[0].folder_path.as_deref(), Some(""));
        assert!(loaded.views[0].archived);
        assert_eq!(saved.content_hash, loaded.content_hash);
        workspace.save_views(vec![], loaded.content_hash).unwrap();
        assert!(workspace.load_views().unwrap().views.is_empty());
        assert_eq!(
            fs::read_dir(dir.path().join(".task-app")).unwrap().count(),
            1
        );
    }

    #[test]
    fn external_edit_creation_and_deletion_reject_stale_writes() {
        let dir = tempfile::tempdir().unwrap();
        let workspace = Workspace::new(dir.path().into());
        let saved = workspace.save_views(vec![view("Original")], None).unwrap();
        assert!(workspace
            .save_views(vec![], None)
            .unwrap_err()
            .contains("VIEWS_CONFLICT"));
        let path = dir.path().join(".task-app/views.json");
        let external = b"{\"version\":1,\"views\":[]}";
        fs::write(&path, external).unwrap();
        assert!(workspace
            .save_views(vec![], saved.content_hash)
            .unwrap_err()
            .contains("VIEWS_CONFLICT"));
        assert_eq!(fs::read(&path).unwrap(), external);
        let hash = workspace.load_views().unwrap().content_hash;
        fs::remove_file(&path).unwrap();
        assert!(workspace
            .save_views(vec![], hash)
            .unwrap_err()
            .contains("VIEWS_CONFLICT"));
    }

    #[test]
    fn corrupt_files_and_invalid_names_are_never_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let workspace = Workspace::new(dir.path().into());
        assert!(workspace.save_views(vec![view(" ")], None).is_err());
        let mut duplicate = view("Same");
        duplicate.id = "other".into();
        assert!(workspace
            .save_views(vec![view("Same"), duplicate], None)
            .is_err());
        let path = dir.path().join(".task-app/views.json");
        for bytes in [
            "broken",
            "{\"version\":2,\"views\":[]}",
            "{\"version\":1,\"views\":[{}]}",
        ] {
            atomic_write(&path, bytes.as_bytes()).unwrap();
            assert!(workspace.load_views().is_err());
            assert!(workspace
                .save_views(vec![], Some(hash_content(bytes.as_bytes())))
                .is_err());
            assert_eq!(fs::read_to_string(&path).unwrap(), bytes);
        }
    }

    #[test]
    fn io_failures_do_not_report_success() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(".task-app"), "not a directory").unwrap();
        let workspace = Workspace::new(dir.path().into());
        assert!(workspace.load_views().is_err());
        assert!(workspace.save_views(vec![], None).is_err());
        assert_eq!(
            fs::read_to_string(dir.path().join(".task-app")).unwrap(),
            "not a directory"
        );
    }
}
