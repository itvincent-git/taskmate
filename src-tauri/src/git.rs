use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::process::Command;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub initialized: bool,
    pub branch: Option<String>,
    pub changes: Vec<String>,
    pub conflicts: Vec<String>,
    pub remote: Option<String>,
    pub ahead: i64,
    pub behind: i64,
    pub last_commit: Option<String>,
    pub last_sync: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHistoryEntry {
    pub hash: String,
    pub date: String,
    pub subject: String,
    pub files: Vec<String>,
}

pub fn initialize(root: &Path) -> Result<GitStatus, String> {
    run(root, &["init"])?;
    status(root)
}

pub fn set_remote(root: &Path, url: &str) -> Result<GitStatus, String> {
    let lower = url.to_lowercase();
    if (url.contains('@') && url.contains("://"))
        || lower.contains("token=")
        || lower.contains("access_token")
        || lower.contains("ghp_")
        || lower.contains("github_pat_")
    {
        return Err("Remote URLs must not contain embedded credentials.".into());
    }
    let existing = run_optional(root, &["remote", "get-url", "origin"]);
    if existing.is_some() {
        run(root, &["remote", "set-url", "origin", url])?;
    } else {
        run(root, &["remote", "add", "origin", url])?;
    }
    status(root)
}

pub fn commit(root: &Path, message: &str) -> Result<GitStatus, String> {
    run(root, &["add", "-A"])?;
    let changed_files = run(
        root,
        &[
            "-c",
            "core.quotePath=false",
            "diff",
            "--cached",
            "--name-status",
            "--no-renames",
            "-z",
        ],
    )?;
    let changes = changed_files
        .split_terminator('\0')
        .collect::<Vec<_>>()
        .chunks_exact(2)
        .map(|entry| {
            let action = match entry[0] {
                "A" => "Add",
                "D" => "Delete",
                _ => "Update",
            };
            format!("{action} {}", entry[1].replace(['\n', '\r'], " "))
        })
        .collect::<Vec<_>>();
    if changes.is_empty() {
        return Err("No changes to commit.".into());
    }
    let subject = if message.trim().is_empty() {
        let mut summary = changes.iter().take(3).cloned().collect::<Vec<_>>().join("; ");
        if changes.len() > 3 {
            summary.push_str(&format!("; {} more", changes.len() - 3));
        }
        summary
    } else {
        message.trim().to_string()
    };
    let details = changes
        .iter()
        .map(|change| format!("- {change}"))
        .collect::<Vec<_>>()
        .join("\n");
    let stats = run(
        root,
        &[
            "-c",
            "core.quotePath=false",
            "diff",
            "--cached",
            "--stat",
            "--stat-width=120",
        ],
    )?;
    let commit_message = format!("{subject}\n\nChanged files:\n{details}\n\n{stats}");
    run(root, &["commit", "-m", &commit_message])?;
    status(root)
}

pub fn push(root: &Path) -> Result<GitStatus, String> {
    reject_conflicts(root)?;
    run(root, &["push", "--set-upstream", "origin", "HEAD"])?;
    record_sync(root)?;
    status(root)
}

pub fn pull(root: &Path) -> Result<GitStatus, String> {
    reject_conflicts(root)?;
    run(root, &["pull", "--no-rebase"])?;
    record_sync(root)?;
    status(root)
}

pub fn history(root: &Path) -> Result<Vec<GitHistoryEntry>, String> {
    let output = run(
        root,
        &[
            "-c",
            "core.quotePath=false",
            "log",
            "-n",
            "20",
            "--pretty=format:%x1e%h%x1f%aI%x1f%s",
            "--name-only",
        ],
    )?;
    Ok(output
        .split('\x1e')
        .filter_map(|record| {
            let (header, files) = record
                .trim()
                .split_once('\n')
                .unwrap_or((record.trim(), ""));
            let mut fields = header.splitn(3, '\x1f');
            Some(GitHistoryEntry {
                hash: fields.next()?.to_string(),
                date: fields.next()?.to_string(),
                subject: fields.next()?.to_string(),
                files: files
                    .lines()
                    .map(str::trim)
                    .filter(|file| !file.is_empty())
                    .map(str::to_string)
                    .collect(),
            })
        })
        .collect())
}

pub fn status(root: &Path) -> Result<GitStatus, String> {
    if !root.join(".git").exists() {
        return Ok(GitStatus {
            initialized: false,
            branch: None,
            changes: vec![],
            conflicts: vec![],
            remote: None,
            ahead: 0,
            behind: 0,
            last_commit: None,
            last_sync: None,
        });
    }
    let porcelain = run(
        root,
        &[
            "-c",
            "core.quotePath=false",
            "status",
            "--porcelain=v1",
            "--branch",
        ],
    )?;
    let mut lines = porcelain.lines();
    let branch_line = lines.next().unwrap_or_default();
    let branch = branch_line
        .strip_prefix("## ")
        .and_then(|value| value.split(['.', ' ']).next())
        .map(str::to_string);
    let changes = lines.map(str::to_string).collect::<Vec<_>>();
    let conflicts = changes
        .iter()
        .filter(|line| {
            matches!(
                &line[..2.min(line.len())],
                "UU" | "AA" | "DD" | "AU" | "UA" | "DU" | "UD"
            )
        })
        .cloned()
        .collect();
    let remote = run_optional(root, &["remote", "get-url", "origin"]);
    let counts = run_optional(
        root,
        &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
    )
    .unwrap_or_default();
    let mut counts = counts
        .split_whitespace()
        .filter_map(|value| value.parse::<i64>().ok());
    let ahead = counts.next().unwrap_or(0);
    let behind = counts.next().unwrap_or(0);
    let last_commit = run_optional(root, &["log", "-1", "--format=%aI"]);
    let last_sync = fs::read_to_string(root.join(".task-app/git-sync.timestamp"))
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    Ok(GitStatus {
        initialized: true,
        branch,
        changes,
        conflicts,
        remote,
        ahead,
        behind,
        last_commit,
        last_sync,
    })
}

fn reject_conflicts(root: &Path) -> Result<(), String> {
    let conflicts = status(root)?.conflicts;
    if conflicts.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "Git conflicts must be resolved first: {}",
            conflicts.join(", ")
        ))
    }
}

fn run_optional(root: &Path, args: &[&str]) -> Option<String> {
    run(root, args).ok().filter(|value| !value.is_empty())
}

fn record_sync(root: &Path) -> Result<(), String> {
    fs::create_dir_all(root.join(".task-app")).map_err(|error| error.to_string())?;
    fs::write(
        root.join(".task-app/git-sync.timestamp"),
        chrono::Utc::now().to_rfc3339(),
    )
    .map_err(|error| format!("Git completed, but its sync timestamp could not be saved: {error}"))
}

fn run(root: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(root)
        .output()
        .map_err(|error| format!("Unable to run Git: {error}"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_reports_uninitialized_directory() {
        let temporary = tempfile::tempdir().unwrap();
        let status = status(temporary.path()).unwrap();
        assert!(!status.initialized);
    }

    #[test]
    fn parses_branch_and_worktree_changes() {
        let temporary = tempfile::tempdir().unwrap();
        initialize(temporary.path()).unwrap();
        std::fs::write(temporary.path().join("task.md"), "# Task").unwrap();
        let status = status(temporary.path()).unwrap();
        assert!(status.initialized);
        assert!(status
            .changes
            .iter()
            .any(|change| change.contains("task.md")));
        assert!(status.conflicts.is_empty());
    }

    #[test]
    fn status_preserves_unicode_file_names() {
        let temporary = tempfile::tempdir().unwrap();
        initialize(temporary.path()).unwrap();
        std::fs::write(temporary.path().join("今日任务.md"), "# Task").unwrap();

        let status = status(temporary.path()).unwrap();

        assert!(status
            .changes
            .iter()
            .any(|change| change.contains("今日任务.md")));
    }

    #[test]
    fn commit_message_lists_changed_files() {
        let temporary = tempfile::tempdir().unwrap();
        initialize(temporary.path()).unwrap();
        run(
            temporary.path(),
            &["config", "user.email", "test@example.com"],
        )
        .unwrap();
        run(temporary.path(), &["config", "user.name", "Taskmate Test"]).unwrap();
        std::fs::create_dir(temporary.path().join("tasks")).unwrap();
        std::fs::write(temporary.path().join("tasks/today.md"), "# Today").unwrap();
        std::fs::write(temporary.path().join("tasks/明日.md"), "# Tomorrow").unwrap();

        commit(temporary.path(), "Taskmate backup").unwrap();

        let message = run(temporary.path(), &["log", "-1", "--format=%B"]).unwrap();
        assert!(message.starts_with("Taskmate backup\n\nChanged files:\n- Add tasks/today.md\n- Add tasks/明日.md"));
        assert!(message.contains("2 files changed, 2 insertions(+)"));
    }

    #[test]
    fn commit_generates_message_from_current_changes() {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path();
        initialize(root).unwrap();
        run(root, &["config", "user.email", "test@example.com"]).unwrap();
        run(root, &["config", "user.name", "Taskmate Test"]).unwrap();
        fs::write(root.join("deleted.md"), "Remove this task\n").unwrap();
        fs::write(root.join("今日任务.md"), "Old task\n").unwrap();
        commit(root, "").unwrap();
        assert_eq!(
            history(root).unwrap()[0].subject,
            "Add deleted.md; Add 今日任务.md"
        );

        fs::write(root.join("added.md"), "New task\n").unwrap();
        fs::remove_file(root.join("deleted.md")).unwrap();
        fs::write(root.join("今日任务.md"), "Updated task\nMore details\n").unwrap();
        commit(root, "   ").unwrap();

        let message = run(root, &["log", "-1", "--format=%B"]).unwrap();
        assert!(message.starts_with("Add added.md; Delete deleted.md; Update 今日任务.md\n"));
        assert!(message.contains("- Add added.md\n- Delete deleted.md\n- Update 今日任务.md"));
        assert!(message.contains("3 files changed, 3 insertions(+), 2 deletions(-)"));
        assert!(status(root).unwrap().changes.is_empty());

        assert_eq!(commit(root, "").unwrap_err(), "No changes to commit.");
        assert_eq!(history(root).unwrap().len(), 2);
    }

    #[test]
    fn generated_subject_limits_files_but_body_lists_every_change() {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path();
        initialize(root).unwrap();
        run(root, &["config", "user.email", "test@example.com"]).unwrap();
        run(root, &["config", "user.name", "Taskmate Test"]).unwrap();
        for name in ["a.md", "b.md", "c.md", "d.md"] {
            fs::write(root.join(name), "Task\n").unwrap();
        }

        commit(root, "").unwrap();

        let message = run(root, &["log", "-1", "--format=%B"]).unwrap();
        assert!(message.starts_with("Add a.md; Add b.md; Add c.md; 1 more\n"));
        assert!(message.contains("- Add d.md"));
    }

    #[test]
    fn history_lists_files_in_each_commit() {
        let temporary = tempfile::tempdir().unwrap();
        initialize(temporary.path()).unwrap();
        run(
            temporary.path(),
            &["config", "user.email", "test@example.com"],
        )
        .unwrap();
        run(temporary.path(), &["config", "user.name", "Taskmate Test"]).unwrap();
        std::fs::create_dir(temporary.path().join("tasks")).unwrap();
        std::fs::write(temporary.path().join("tasks/today.md"), "# Today").unwrap();
        std::fs::write(temporary.path().join("tasks/明日.md"), "# Tomorrow").unwrap();
        commit(temporary.path(), "Taskmate backup").unwrap();

        let entries = history(temporary.path()).unwrap();

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].subject, "Taskmate backup");
        assert_eq!(entries[0].files, vec!["tasks/today.md", "tasks/明日.md"]);
    }

    #[test]
    fn push_sets_upstream_for_current_branch() {
        let remote = tempfile::tempdir().unwrap();
        run(remote.path(), &["init", "--bare"]).unwrap();

        let workspace = tempfile::tempdir().unwrap();
        initialize(workspace.path()).unwrap();
        run(workspace.path(), &["config", "user.email", "test@example.com"]).unwrap();
        run(workspace.path(), &["config", "user.name", "Taskmate Test"]).unwrap();
        std::fs::write(workspace.path().join("task.md"), "# Task").unwrap();
        commit(workspace.path(), "Initial task").unwrap();
        set_remote(
            workspace.path(),
            remote.path().to_str().expect("temporary path is UTF-8"),
        )
        .unwrap();

        push(workspace.path()).unwrap();

        let branch = run(workspace.path(), &["branch", "--show-current"]).unwrap();
        assert_eq!(
            run(
                workspace.path(),
                &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
            )
            .unwrap(),
            format!("origin/{branch}")
        );
    }
}
