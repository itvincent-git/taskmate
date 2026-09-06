use serde::{Deserialize, Serialize};
use serde_yaml::{Mapping, Value};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub title: String,
    pub file_name: String,
    #[serde(default)]
    pub folder_path: String,
    pub body: String,
    pub archived: bool,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub properties: BTreeMap<String, Value>,
    pub content_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskSummary {
    pub id: String,
    pub title: String,
    pub file_name: String,
    #[serde(default)]
    pub folder_path: String,
    pub archived: bool,
    pub created_at: String,
    pub updated_at: String,
    pub properties: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskSearchResult {
    pub folder_path: String,
    pub id: String,
    pub title: String,
    pub archived: bool,
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveTaskInput {
    pub id: String,
    pub title: String,
    pub body: String,
    pub archived: bool,
    pub created_at: String,
    pub properties: BTreeMap<String, Value>,
    pub expected_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PropertyOption {
    pub id: String,
    pub label: String,
    pub color: Option<String>,
    pub order: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PropertyDefinition {
    pub id: String,
    pub key: String,
    pub name: String,
    #[serde(rename = "type")]
    pub property_type: String,
    pub show_in_detail: bool,
    pub show_in_card: bool,
    pub enable_filter: bool,
    pub enable_sort: bool,
    #[serde(default)]
    pub required: bool,
    pub default_value: Option<Value>,
    #[serde(default)]
    pub options: Vec<PropertyOption>,
    pub order: i64,
    #[serde(default)]
    pub role: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TaskQuery {
    pub folder_path: Option<String>,
    #[serde(default)]
    pub search: String,
    #[serde(default)]
    pub archived: bool,
    #[serde(default)]
    pub filters: Vec<TaskFilter>,
    #[serde(default)]
    pub sorts: Vec<TaskSort>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskFilter {
    pub key: String,
    pub operator: String,
    pub value: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskSort {
    pub key: String,
    pub direction: String,
    #[serde(default = "default_nulls")]
    pub nulls: String,
}

fn default_nulls() -> String {
    "last".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSnapshot {
    pub path: String,
    pub properties: Vec<PropertyDefinition>,
    pub tasks: Vec<TaskSummary>,
    pub index_rebuilt: bool,
    pub folders: Vec<Folder>,
}

pub fn frontmatter_from_task(task: &Task) -> Mapping {
    let mut map = Mapping::new();
    map.insert(Value::String("id".into()), Value::String(task.id.clone()));
    map.insert(
        Value::String("title".into()),
        Value::String(task.title.clone()),
    );
    map.insert(Value::String("archived".into()), Value::Bool(task.archived));
    map.insert(
        Value::String("createdAt".into()),
        Value::String(task.created_at.clone()),
    );
    map.insert(
        Value::String("updatedAt".into()),
        Value::String(task.updated_at.clone()),
    );
    for (key, value) in &task.properties {
        if !matches!(
            key.as_str(),
            "id" | "title" | "archived" | "createdAt" | "updatedAt"
        ) {
            map.insert(Value::String(key.clone()), value.clone());
        }
    }
    map
}

impl From<&Task> for TaskSummary {
    fn from(task: &Task) -> Self {
        Self {
            id: task.id.clone(),
            title: task.title.clone(),
            file_name: task.file_name.clone(),
            folder_path: task.folder_path.clone(),
            archived: task.archived,
            created_at: task.created_at.clone(),
            updated_at: task.updated_at.clone(),
            properties: task.properties.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub path: String,
    pub archived: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveTasksResult {
    pub completed: Vec<String>,
    pub remaining: Vec<String>,
    pub error: Option<String>,
}
