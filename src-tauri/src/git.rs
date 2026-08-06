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
    run(root, &["commit", "-m", message])?;
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

pub fn history(root: &Path) -> Result<Vec<String>, String> {
    Ok(run(
        root,
        &["log", "-n", "20", "--pretty=format:%h%x09%aI%x09%s"],
    )?
    .lines()
    .map(str::to_string)
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
