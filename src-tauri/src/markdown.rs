use crate::model::{frontmatter_from_task, Task};
use serde_yaml::{Mapping, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::Path;

pub fn hash_content(content: &[u8]) -> String {
    hex::encode(Sha256::digest(content))
}

pub fn parse_task(path: &Path, text: &str) -> Result<Task, String> {
    let normalized = text.replace("\r\n", "\n");
    let remainder = normalized
        .strip_prefix("---\n")
        .ok_or_else(|| "Task file must begin with YAML frontmatter.".to_string())?;
    let end = remainder
        .find("\n---")
        .ok_or_else(|| "Task frontmatter is missing its closing delimiter.".to_string())?;
    let yaml = &remainder[..end];
    let after_frontmatter = &remainder[end + 4..];
    let body = after_frontmatter
        .strip_prefix("\n\n")
        .or_else(|| after_frontmatter.strip_prefix('\n'))
        .unwrap_or(after_frontmatter);
    let mut map: Mapping =
        serde_yaml::from_str(yaml).map_err(|error| format!("Invalid frontmatter: {error}"))?;

    let id = take_string(&mut map, "id")?;
    let title = take_string(&mut map, "title")?;
    let archived = take_bool(&mut map, "archived").unwrap_or(false);
    let created_at = take_string(&mut map, "createdAt")?;
    let updated_at = take_string(&mut map, "updatedAt")?;
    let properties = map
        .into_iter()
        .filter_map(|(key, value)| key.as_str().map(|key| (key.to_string(), value)))
        .collect::<BTreeMap<_, _>>();

    Ok(Task {
        id,
        title,
        file_name: path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default()
            .to_string(),
        folder_path: String::new(),
        body: body.to_string(),
        archived,
        created_at,
        updated_at,
        properties,
        content_hash: hash_content(text.as_bytes()),
    })
}

pub fn serialize_task(task: &Task) -> Result<String, String> {
    let yaml = serde_yaml::to_string(&frontmatter_from_task(task))
        .map_err(|error| format!("Unable to serialize frontmatter: {error}"))?;
    Ok(format!("---\n{}---\n\n{}", yaml, task.body))
}

fn take_string(map: &mut Mapping, key: &str) -> Result<String, String> {
    map.remove(Value::String(key.into()))
        .and_then(|value| value.as_str().map(ToOwned::to_owned))
        .ok_or_else(|| format!("Frontmatter field '{key}' must be a string."))
}

fn take_bool(map: &mut Mapping, key: &str) -> Option<bool> {
    map.remove(Value::String(key.into()))
        .and_then(|value| value.as_bool())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn round_trip_preserves_unknown_properties() {
        let source = "---\nid: task-1\ntitle: Example\narchived: false\ncreatedAt: 2026-01-01T00:00:00Z\nupdatedAt: 2026-01-02T00:00:00Z\ncustom:\n  nested: true\n---\n\n# Body";
        let path = PathBuf::from("example.md");
        let first = parse_task(&path, source).unwrap();
        assert_eq!(first.properties["custom"]["nested"], Value::Bool(true));
        let serialized = serialize_task(&first).unwrap();
        let second = parse_task(&path, &serialized).unwrap();
        assert_eq!(first.id, second.id);
        assert_eq!(first.body, second.body);
        assert_eq!(first.properties, second.properties);
    }

    #[test]
    fn rejects_missing_required_frontmatter() {
        assert!(parse_task(Path::new("bad.md"), "---\ntitle: Missing ID\n---\n").is_err());
    }

    #[test]
    fn round_trips_a_one_megabyte_markdown_body() {
        let body = "文".repeat(350_000);
        let source = format!(
            "---\nid: large\ntitle: Large\narchived: false\ncreatedAt: 2026-01-01T00:00:00Z\nupdatedAt: 2026-01-01T00:00:00Z\n---\n\n{body}"
        );
        let task = parse_task(Path::new("large.md"), &source).unwrap();
        assert!(task.body.len() >= 1_000_000);
        assert_eq!(
            parse_task(Path::new("large.md"), &serialize_task(&task).unwrap())
                .unwrap()
                .body,
            task.body
        );
    }
}
