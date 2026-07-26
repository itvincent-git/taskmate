use crate::model::{PropertyDefinition, Task, TaskFilter, TaskQuery, TaskSort, TaskSummary};
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
        Ok(Self { connection })
    }

    pub fn upsert(&self, task: &Task, path: &Path, mtime: i64) -> Result<(), String> {
        let properties = serde_json::to_string(&task.properties).map_err(to_string)?;
        self.connection
            .execute(
                "INSERT INTO tasks(id,file_path,title,body,archived,created_at,updated_at,properties_json,content_hash,file_mtime)
                 VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
                 ON CONFLICT(id) DO UPDATE SET file_path=excluded.file_path,title=excluded.title,body=excluded.body,
                 archived=excluded.archived,updated_at=excluded.updated_at,properties_json=excluded.properties_json,
                 content_hash=excluded.content_hash,file_mtime=excluded.file_mtime",
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
                    mtime
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
                "SELECT id,title,file_path,archived,created_at,updated_at,properties_json,body
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
        let mut tasks = rows
            .into_iter()
            .filter(|(task, body)| {
                (needle.is_empty()
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
                        .all(|filter| matches_filter(task, filter))
            })
            .map(|(task, _)| task)
            .collect::<Vec<_>>();

        tasks.sort_by(|left, right| compare_tasks(left, right, query.sort.as_ref(), definitions));
        Ok(tasks)
    }
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

fn matches_filter(task: &TaskSummary, filter: &TaskFilter) -> bool {
    let actual = value_for(task, &filter.key);
    let expected = filter.value.as_ref();
    match filter.operator.as_str() {
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
    sort: Option<&TaskSort>,
    definitions: &[PropertyDefinition],
) -> Ordering {
    let primary = sort
        .map(|sort| {
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
        })
        .unwrap_or(Ordering::Equal);
    primary
        .then_with(|| right.updated_at.cmp(&left.updated_at))
        .then_with(|| left.title.to_lowercase().cmp(&right.title.to_lowercase()))
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
    use std::collections::BTreeMap;

    fn task(id: &str, title: &str, priority: i64, status: &str, tags: &[&str]) -> Task {
        Task {
            id: id.into(),
            title: title.into(),
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
                    sort: Some(TaskSort {
                        key: "score".into(),
                        direction: "asc".into(),
                        nulls: "last".into(),
                    }),
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
