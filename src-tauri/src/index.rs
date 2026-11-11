use crate::model::{
    PropertyDefinition, Task, TaskFilter, TaskQuery, TaskSearchResult, TaskSort, TaskSummary,
};
use rusqlite::OptionalExtension;
use rusqlite::{params, Connection};
use serde_yaml::Value;
use std::cmp::Ordering;
use std::path::Path;

pub struct TaskIndex {
    connection: Connection,
}

impl TaskIndex {
    pub fn open(path: &Path) -> Result<Self, String> {
        let connection = Connection::open(path).map_err(to_string)?;
        connection
            .execute_batch(
                "PRAGMA journal_mode=WAL;
                 CREATE TABLE IF NOT EXISTS tasks (
                    id TEXT PRIMARY KEY,
                    file_path TEXT NOT NULL UNIQUE,
                    title TEXT NOT NULL,
                    body TEXT NOT NULL,
                    archived INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    properties_json TEXT NOT NULL,
                    content_hash TEXT NOT NULL,
                    file_mtime INTEGER NOT NULL
                 );
                 CREATE INDEX IF NOT EXISTS idx_tasks_archived_updated ON tasks(archived, updated_at DESC);
                 CREATE INDEX IF NOT EXISTS idx_tasks_title ON tasks(title);",
            )
            .map_err(to_string)?;
        if connection
            .prepare("SELECT folder_path FROM tasks LIMIT 0")
            .is_err()
        {
            connection
                .execute(
                    "ALTER TABLE tasks ADD COLUMN folder_path TEXT NOT NULL DEFAULT ''",
                    [],
                )
                .map_err(to_string)?;
        }
        Ok(Self { connection })
    }

    pub fn upsert(&self, task: &Task, path: &Path, mtime: i64) -> Result<(), String> {
        let properties = serde_json::to_string(&task.properties).map_err(to_string)?;
        self.connection
            .execute(
                "INSERT INTO tasks(id,file_path,title,body,archived,created_at,updated_at,properties_json,content_hash,file_mtime,folder_path)
                 VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)
                 ON CONFLICT(id) DO UPDATE SET file_path=excluded.file_path,title=excluded.title,body=excluded.body,
                 archived=excluded.archived,updated_at=excluded.updated_at,properties_json=excluded.properties_json,
                 content_hash=excluded.content_hash,file_mtime=excluded.file_mtime,folder_path=excluded.folder_path",
                params![
                    task.id,
                    path.to_string_lossy(),
                    task.title,
                    task.body,
                    task.archived,
                    task.created_at,
                    task.updated_at,
                    properties,
                    task.content_hash,
                    mtime,
                    task.folder_path
                ],
            )
            .map_err(to_string)?;
        Ok(())
    }

    pub fn remove(&self, id: &str) -> Result<(), String> {
        self.connection
            .execute("DELETE FROM tasks WHERE id=?1", params![id])
            .map_err(to_string)?;
        Ok(())
    }

    pub fn path_for_id(&self, id: &str) -> Result<Option<String>, String> {
        self.connection
            .query_row(
                "SELECT file_path FROM tasks WHERE id=?1",
                params![id],
                |row| row.get(0),
            )
            .optional()
            .map_err(to_string)
    }

    pub fn remove_path(&self, path: &str) -> Result<(), String> {
        self.connection
            .execute("DELETE FROM tasks WHERE file_path=?1", params![path])
            .map_err(to_string)?;
        Ok(())
    }

    pub fn clear(&self) -> Result<(), String> {
        self.connection
            .execute("DELETE FROM tasks", [])
            .map_err(to_string)?;
        Ok(())
    }

    pub fn indexed_state(&self) -> Result<Vec<(String, String, i64, String)>, String> {
        let mut statement = self
            .connection
            .prepare("SELECT id,file_path,file_mtime,content_hash FROM tasks")
            .map_err(to_string)?;
        let rows = statement
            .query_map([], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })
            .map_err(to_string)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(to_string)?;
        Ok(rows)
    }

    pub fn query(
        &self,
        query: &TaskQuery,
        definitions: &[PropertyDefinition],
    ) -> Result<Vec<TaskSummary>, String> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT id,title,file_path,archived,created_at,updated_at,properties_json,body,folder_path
                 FROM tasks WHERE archived=?1",
            )
            .map_err(to_string)?;
        let rows = statement
            .query_map(params![query.archived], |row| {
                let file_path: String = row.get(2)?;
                let properties_json: String = row.get(6)?;
                Ok((
                    TaskSummary {
                        id: row.get(0)?,
                        title: row.get(1)?,
                        file_name: Path::new(&file_path)
                            .file_name()
                            .and_then(|name| name.to_str())
                            .unwrap_or_default()
                            .to_string(),
                        folder_path: row.get(8)?,
                        archived: row.get(3)?,
                        created_at: row.get(4)?,
                        updated_at: row.get(5)?,
                        properties: serde_json::from_str(&properties_json).unwrap_or_default(),
                    },
                    row.get::<_, String>(7)?,
                ))
            })
            .map_err(to_string)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(to_string)?;

        let needle = query.search.trim().to_lowercase();
        let now = chrono::Utc::now();
        let mut tasks = rows
            .into_iter()
            .filter(|(task, body)| {
                query.folder_path.as_ref().is_none_or(|folder| {
                    task.folder_path == *folder
                        || (!folder.is_empty()
                            && task.folder_path.starts_with(&format!("{folder}/")))
                }) && (needle.is_empty()
                    || task.title.to_lowercase().contains(&needle)
                    || task.file_name.to_lowercase().contains(&needle)
                    || body.to_lowercase().contains(&needle)
                    || task
                        .properties
                        .values()
                        .any(|value| searchable(value).to_lowercase().contains(&needle)))
                    && query
                        .filters
                        .iter()
                        .all(|filter| matches_filter(task, filter, now))
            })
            .map(|(task, _)| task)
            .collect::<Vec<_>>();

        tasks.sort_by(|left, right| compare_tasks(left, right, &query.sorts, definitions));
        Ok(tasks)
    }

    pub fn query_documents(
        &self,
        query: &TaskQuery,
        definitions: &[PropertyDefinition],
    ) -> Result<Vec<Task>, String> {
        let summaries = self.query(query, definitions)?;
        let mut statement = self
            .connection
            .prepare("SELECT body,content_hash FROM tasks WHERE id=?1")
            .map_err(to_string)?;
        summaries
            .into_iter()
            .map(|summary| {
                let (body, content_hash) = statement
                    .query_row(params![summary.id], |row| {
                        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                    })
                    .map_err(to_string)?;
                Ok(Task {
                    id: summary.id,
                    title: summary.title,
                    file_name: summary.file_name,
                    folder_path: summary.folder_path,
                    archived: summary.archived,
                    created_at: summary.created_at,
                    updated_at: summary.updated_at,
                    properties: summary.properties,
                    body,
                    content_hash,
                })
            })
            .collect()
    }

    pub fn search(&self, search: &str) -> Result<Vec<TaskSearchResult>, String> {
        let needle = folded_chars(search.trim());
        if needle.is_empty() {
            return Ok(Vec::new());
        }
        let mut statement = self
            .connection
            .prepare("SELECT id,title,archived,updated_at,body,folder_path FROM tasks")
            .map_err(to_string)?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, bool>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                ))
            })
            .map_err(to_string)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(to_string)?;

        let mut matches = rows
            .into_iter()
            .filter_map(|(id, title, archived, updated_at, body, folder_path)| {
                let title_match = find_folded(&title, &needle).is_some();
                let body_match = find_folded(&body, &needle);
                (title_match || body_match.is_some()).then(|| {
                    let body_chars = body.chars().collect::<Vec<_>>();
                    let match_start = body_match.map_or(0, |(start, _)| start);
                    let start = if body_match.is_some() {
                        match_start.saturating_sub(80)
                    } else {
                        0
                    };
                    let snippet = body_chars.into_iter().skip(start).take(200).collect();
                    (
                        TaskSearchResult {
                            folder_path,
                            id,
                            title,
                            archived,
                            snippet,
                        },
                        title_match,
                        updated_at,
                    )
                })
            })
            .collect::<Vec<_>>();
        matches.sort_by(|left, right| right.1.cmp(&left.1).then_with(|| right.2.cmp(&left.2)));
        Ok(matches.into_iter().map(|(result, _, _)| result).collect())
    }
}

fn folded_chars(value: &str) -> Vec<char> {
    value.chars().flat_map(char::to_lowercase).collect()
}

fn find_folded(value: &str, needle: &[char]) -> Option<(usize, usize)> {
    let mut folded = Vec::new();
    let mut source_indexes = Vec::new();
    for (source_index, character) in value.chars().enumerate() {
        for folded_character in character.to_lowercase() {
            folded.push(folded_character);
            source_indexes.push(source_index);
        }
    }
    folded
        .windows(needle.len())
        .position(|window| window == needle)
        .map(|start| {
            let end = source_indexes[start + needle.len() - 1] + 1;
            (source_indexes[start], end)
        })
}

fn searchable(value: &Value) -> String {
    match value {
        Value::String(value) => value.clone(),
        Value::Sequence(values) => values.iter().map(searchable).collect::<Vec<_>>().join(" "),
        Value::Mapping(values) => values
            .values()
            .map(searchable)
            .collect::<Vec<_>>()
            .join(" "),
        other => serde_yaml::to_string(other).unwrap_or_default(),
    }
}

fn value_for<'a>(task: &'a TaskSummary, key: &str) -> Option<&'a Value> {
    task.properties.get(key)
}

fn matches_filter(
    task: &TaskSummary,
    filter: &TaskFilter,
    now: chrono::DateTime<chrono::Utc>,
) -> bool {
    let actual = value_for(task, &filter.key);
    let expected = filter.value.as_ref();
    match filter.operator.as_str() {
        "withinLastDays" | "olderThanDays" => {
            if filter.key != "updatedAt" {
                return false;
            }
            let Some(days) = expected.and_then(Value::as_i64).filter(|days| *days > 0) else {
                return false;
            };
            let Some(duration) = chrono::TimeDelta::try_days(days) else {
                return false;
            };
            let Some(threshold) = now.checked_sub_signed(duration) else {
                return false;
            };
            let Ok(updated) = chrono::DateTime::parse_from_rfc3339(&task.updated_at) else {
                return false;
            };
            if filter.operator == "withinLastDays" {
                updated >= threshold && updated <= now
            } else {
                updated < threshold
            }
        }
        "unset" => actual.is_none() || actual == Some(&Value::Null),
        "set" => actual.is_some() && actual != Some(&Value::Null),
        "contains" => actual
            .map(searchable)
            .zip(expected.map(searchable))
            .is_some_and(|(a, b)| a.to_lowercase().contains(&b.to_lowercase())),
        "notContains" => !matches_filter(
            task,
            &TaskFilter {
                operator: "contains".into(),
                ..filter.clone()
            },
            now,
        ),
        "any" => sequence_overlap(actual, expected, false),
        "all" => sequence_overlap(actual, expected, true),
        "gt" => compare_values(actual, expected) == Ordering::Greater,
        "lt" => compare_values(actual, expected) == Ordering::Less,
        "gte" => compare_values(actual, expected) != Ordering::Less,
        "lte" => compare_values(actual, expected) != Ordering::Greater,
        "eq" | _ => compare_values(actual, expected) == Ordering::Equal,
    }
}

fn sequence_overlap(actual: Option<&Value>, expected: Option<&Value>, all: bool) -> bool {
    let actual = actual.and_then(Value::as_sequence);
    let expected = expected.and_then(Value::as_sequence);
    match (actual, expected) {
        (Some(actual), Some(expected)) if all => expected.iter().all(|item| actual.contains(item)),
        (Some(actual), Some(expected)) => expected.iter().any(|item| actual.contains(item)),
        _ => false,
    }
}

fn compare_values(left: Option<&Value>, right: Option<&Value>) -> Ordering {
    match (left, right) {
        (None | Some(Value::Null), None | Some(Value::Null)) => Ordering::Equal,
        (None | Some(Value::Null), _) => Ordering::Greater,
        (_, None | Some(Value::Null)) => Ordering::Less,
        (Some(Value::Number(a)), Some(Value::Number(b))) => a
            .as_f64()
            .partial_cmp(&b.as_f64())
            .unwrap_or(Ordering::Equal),
        (Some(Value::Bool(a)), Some(Value::Bool(b))) => a.cmp(b),
        (Some(a), Some(b)) => searchable(a)
            .to_lowercase()
            .cmp(&searchable(b).to_lowercase()),
    }
}

fn compare_tasks(
    left: &TaskSummary,
    right: &TaskSummary,
    sorts: &[TaskSort],
    definitions: &[PropertyDefinition],
) -> Ordering {
    sorts
        .iter()
        .map(|sort| compare_task_sort(left, right, sort, definitions))
        .find(|order| *order != Ordering::Equal)
        .unwrap_or(Ordering::Equal)
        .then_with(|| right.updated_at.cmp(&left.updated_at))
        .then_with(|| left.title.to_lowercase().cmp(&right.title.to_lowercase()))
}

fn compare_task_sort(
    left: &TaskSummary,
    right: &TaskSummary,
    sort: &TaskSort,
    definitions: &[PropertyDefinition],
) -> Ordering {
    if sort.key != "title" && sort.key != "updatedAt" {
        let left_value = left.properties.get(&sort.key);
        let right_value = right.properties.get(&sort.key);
        let left_null = left_value.is_none_or(|value| *value == Value::Null);
        let right_null = right_value.is_none_or(|value| *value == Value::Null);
        if left_null != right_null {
            return if left_null == (sort.nulls == "first") {
                Ordering::Less
            } else {
                Ordering::Greater
            };
        }
    }
    let order = if sort.key == "title" {
        left.title.to_lowercase().cmp(&right.title.to_lowercase())
    } else if sort.key == "updatedAt" {
        left.updated_at.cmp(&right.updated_at)
    } else {
        let definition = definitions
            .iter()
            .find(|definition| definition.key == sort.key);
        match definition.map(|definition| definition.property_type.as_str()) {
            Some("select") => compare_option_values(
                left.properties.get(&sort.key),
                right.properties.get(&sort.key),
                definition.unwrap(),
            ),
            _ => compare_values(
                left.properties.get(&sort.key),
                right.properties.get(&sort.key),
            ),
        }
    };
    if sort.direction == "desc" {
        order.reverse()
    } else {
        order
    }
}

fn compare_option_values(
    left: Option<&Value>,
    right: Option<&Value>,
    definition: &PropertyDefinition,
) -> Ordering {
    let order_for = |value: Option<&Value>| {
        value
            .and_then(Value::as_str)
            .and_then(|id| definition.options.iter().find(|option| option.id == id))
            .map(|option| option.order)
            .unwrap_or(i64::MAX)
    };
    order_for(left).cmp(&order_for(right))
}

fn to_string(error: impl ToString) -> String {
    error.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relative_update_filters_use_rolling_inclusive_bounds_and_valid_instants() {
        let now = chrono::DateTime::parse_from_rfc3339("2026-11-11T12:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        let mut item = TaskSummary::from(&task("relative", "Relative", 1, "doing", &[]));
        let recent = TaskFilter {
            key: "updatedAt".into(),
            operator: "withinLastDays".into(),
            value: Some(Value::Number(7.into())),
        };
        let old = TaskFilter {
            operator: "olderThanDays".into(),
            ..recent.clone()
        };
        for (timestamp, within, older) in [
            ("2026-11-04T12:00:00Z", true, false),
            ("2026-11-04T20:00:00+08:00", true, false),
            ("2026-11-04T11:59:59.999Z", false, true),
            ("2026-11-11T12:00:00Z", true, false),
            ("2026-11-11T12:00:00.001Z", false, false),
            ("invalid", false, false),
            ("2026-11-04", false, false),
        ] {
            item.updated_at = timestamp.into();
            assert_eq!(matches_filter(&item, &recent, now), within, "{timestamp}");
            assert_eq!(matches_filter(&item, &old, now), older, "{timestamp}");
        }
        for value in [
            Value::Number(0.into()),
            Value::Number((-1).into()),
            Value::Number(1.5.into()),
            Value::String("7".into()),
            Value::Number(i64::MAX.into()),
            Value::Null,
        ] {
            assert!(!matches_filter(
                &item,
                &TaskFilter {
                    value: Some(value),
                    ..recent.clone()
                },
                now
            ));
        }
    }
    use std::collections::BTreeMap;

    fn task(id: &str, title: &str, priority: i64, status: &str, tags: &[&str]) -> Task {
        Task {
            id: id.into(),
            title: title.into(),
            folder_path: String::new(),
            file_name: format!("{id}.md"),
            body: format!("Body for {title}"),
            archived: false,
            created_at: "2026-01-01T00:00:00Z".into(),
            updated_at: format!("2026-01-0{}T00:00:00Z", priority + 1),
            properties: BTreeMap::from([
                ("score".into(), Value::Number(priority.into())),
                ("status".into(), Value::String(status.into())),
                (
                    "tags".into(),
                    Value::Sequence(
                        tags.iter()
                            .map(|tag| Value::String((*tag).into()))
                            .collect(),
                    ),
                ),
            ]),
            content_hash: id.into(),
        }
    }

    #[test]
    fn indexes_updates_deletes_filters_and_numeric_sorting() {
        let temporary = tempfile::tempdir().unwrap();
        let index = TaskIndex::open(&temporary.path().join("index.sqlite")).unwrap();
        let first = task("a", "Alpha", 10, "doing", &["rust", "tauri"]);
        let second = task("b", "Beta", 2, "done", &["rust"]);
        index
            .upsert(&first, &temporary.path().join("a.md"), 1)
            .unwrap();
        index
            .upsert(&second, &temporary.path().join("b.md"), 1)
            .unwrap();
        let query = TaskQuery {
            filters: vec![
                TaskFilter {
                    key: "status".into(),
                    operator: "eq".into(),
                    value: Some(Value::String("doing".into())),
                },
                TaskFilter {
                    key: "tags".into(),
                    operator: "all".into(),
                    value: Some(Value::Sequence(vec![
                        Value::String("rust".into()),
                        Value::String("tauri".into()),
                    ])),
                },
            ],
            ..TaskQuery::default()
        };
        assert_eq!(index.query(&query, &[]).unwrap()[0].id, "a");

        let sorted = index
            .query(
                &TaskQuery {
                    sorts: vec![TaskSort {
                        key: "score".into(),
                        direction: "asc".into(),
                        nulls: "last".into(),
                    }],
                    ..TaskQuery::default()
                },
                &[],
            )
            .unwrap();
        assert_eq!(
            sorted
                .iter()
                .map(|task| task.id.as_str())
                .collect::<Vec<_>>(),
            ["b", "a"]
        );
        index.remove("a").unwrap();
        assert_eq!(index.query(&TaskQuery::default(), &[]).unwrap().len(), 1);
    }

    #[test]
    fn sorts_by_multiple_fields_in_priority_order() {
        let temporary = tempfile::tempdir().unwrap();
        let index = TaskIndex::open(&temporary.path().join("index.sqlite")).unwrap();
        for task in [
            task("a", "Alpha", 2, "group-b", &[]),
            task("b", "Beta", 10, "group-b", &[]),
            task("c", "Charlie", 5, "group-a", &[]),
        ] {
            index
                .upsert(&task, &temporary.path().join(&task.file_name), 1)
                .unwrap();
        }

        let sorted = index
            .query(
                &TaskQuery {
                    sorts: vec![
                        TaskSort {
                            key: "status".into(),
                            direction: "asc".into(),
                            nulls: "last".into(),
                        },
                        TaskSort {
                            key: "score".into(),
                            direction: "desc".into(),
                            nulls: "last".into(),
                        },
                    ],
                    ..TaskQuery::default()
                },
                &[],
            )
            .unwrap();

        assert_eq!(
            sorted
                .iter()
                .map(|task| task.id.as_str())
                .collect::<Vec<_>>(),
            ["c", "b", "a"]
        );
    }

    #[test]
    fn searches_titles_and_bodies_across_archive_with_bounded_unicode_snippets() {
        let temporary = tempfile::tempdir().unwrap();
        let index = TaskIndex::open(&temporary.path().join("index.sqlite")).unwrap();
        let mut title_match = task("title", "Needle title", 1, "doing", &[]);
        title_match.body = "Opening text".into();
        let mut body_match = task("body", "Body result", 2, "done", &[]);
        body_match.body = format!("{} needle {}", "界".repeat(120), "尾".repeat(200));
        body_match.archived = true;
        let mut ignored = task("ignored", "Ignored", 3, "needle", &[]);
        ignored.file_name = "needle.md".into();
        ignored.body = "No match".into();
        for current in [&title_match, &body_match, &ignored] {
            index
                .upsert(current, &temporary.path().join(&current.file_name), 1)
                .unwrap();
        }

        let results = index.search("needle").unwrap();
        assert_eq!(
            results
                .iter()
                .map(|result| result.id.as_str())
                .collect::<Vec<_>>(),
            ["title", "body"]
        );
        assert!(results[1].archived);
        assert!(results[1].snippet.contains("needle"));
        assert_eq!(results[1].snippet.chars().count(), 200);
        assert!(!results[1].snippet.ends_with(&"尾".repeat(200)));
        assert!(index.search("   ").unwrap().is_empty());
    }

    #[test]
    fn queries_five_thousand_indexed_tasks() {
        let temporary = tempfile::tempdir().unwrap();
        let index = TaskIndex::open(&temporary.path().join("index.sqlite")).unwrap();
        for number in 0..5_000 {
            let task = task(
                &format!("task-{number}"),
                &format!("Task {number}"),
                number % 20,
                if number % 2 == 0 { "doing" } else { "done" },
                &["scale"],
            );
            index
                .upsert(
                    &task,
                    &temporary.path().join(format!("task-{number}.md")),
                    number,
                )
                .unwrap();
        }
        let result = index
            .query(
                &TaskQuery {
                    search: "Task 4999".into(),
                    ..TaskQuery::default()
                },
                &[],
            )
            .unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].id, "task-4999");
    }
}
