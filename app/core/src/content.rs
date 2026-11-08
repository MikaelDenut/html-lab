use crate::kinds::KINDS;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

const STARTERS_JSON: &str = include_str!("../content/starters.json");
const SAMPLES_JSON: &str = include_str!("../content/samples.json");
const HELP_JSON: &str = include_str!("../content/help.json");
const HELP_EFFECTS_JSON: &str = include_str!("../content/help-effects.json");
const HELP_DESIGN_JSON: &str = include_str!("../content/help-design.json");
const HELP_EXTRA: [(&str, &str); 2] = [
    ("content/help-design.json", HELP_DESIGN_JSON),
    ("content/help-effects.json", HELP_EFFECTS_JSON),
];

const PICTURES: [(&str, &[u8]); 7] = [
    (
        "my-picture.jpg",
        include_bytes!("../content/pictures/my-picture.jpg"),
    ),
    ("stars.jpg", include_bytes!("../content/pictures/stars.jpg")),
    (
        "saturn.jpg",
        include_bytes!("../content/pictures/saturn.jpg"),
    ),
    ("mars.jpg", include_bytes!("../content/pictures/mars.jpg")),
    ("tree.jpg", include_bytes!("../content/pictures/tree.jpg")),
    ("sun.jpg", include_bytes!("../content/pictures/sun.jpg")),
    ("boat.jpg", include_bytes!("../content/pictures/boat.jpg")),
];

static GALLERY_DIR: OnceLock<PathBuf> = OnceLock::new();

pub fn set_gallery_dir(dir: PathBuf) {
    let _ = GALLERY_DIR.set(dir);
}

const SOURCE_GALLERY: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/content/gallery");

pub fn gallery_dir() -> Option<&'static Path> {
    match GALLERY_DIR.get() {
        Some(dir) => Some(dir.as_path()),
        None if cfg!(debug_assertions) => Some(Path::new(SOURCE_GALLERY)),
        None => None,
    }
}

pub fn gallery_image(path: &str) -> Option<Vec<u8>> {
    let (folder, name) = path.strip_prefix('/')?.split_once('/')?;
    if !matches!(folder, "previews" | "thumbs") || !plain_picture_name(name) {
        return None;
    }
    std::fs::read(gallery_dir()?.join(folder).join(name)).ok()
}

fn plain_picture_name(name: &str) -> bool {
    let Some((stem, ext)) = name.rsplit_once('.') else {
        return false;
    };
    !stem.is_empty()
        && stem.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        && matches!(ext, "jpg" | "png" | "webp")
}

fn gallery_picture(name: &str) -> Option<&'static [u8]> {
    if !plain_picture_name(name) {
        return None;
    }
    static READ: OnceLock<Mutex<HashMap<String, &'static [u8]>>> = OnceLock::new();
    let mut read = READ.get_or_init(Default::default).lock().ok()?;
    if let Some(bytes) = read.get(name) {
        return Some(bytes);
    }
    let bytes = std::fs::read(gallery_dir()?.join("pictures").join(name)).ok()?;
    let kept: &'static [u8] = Box::leak(bytes.into_boxed_slice());
    read.insert(name.to_string(), kept);
    Some(kept)
}

pub fn picture(name: &str) -> Option<&'static [u8]> {
    PICTURES
        .iter()
        .find(|(known, _)| *known == name)
        .map(|(_, bytes)| *bytes)
        .or_else(|| gallery_picture(name))
}

const INDEX_FIELDS: [&str; 7] = [
    "id", "group", "kind", "section", "title", "short", "keywords",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentFile {
    pub name: String,
    #[serde(default)]
    pub code: String,
    #[serde(default)]
    pub hidden: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub picture: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectContent {
    pub id: String,
    pub name: String,
    pub files: Vec<ContentFile>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SampleSummary {
    pub id: String,
    pub title: String,
    pub blurb: String,
    pub style: String,
    pub group: String,
    pub shows: Vec<String>,
    pub accent: String,
    pub category: String,
    pub layout: String,
    pub needs: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewFileContent {
    pub file: String,
    pub text: String,
}

#[derive(Deserialize)]
struct FileTemplate {
    text: String,
    #[serde(default)]
    link: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Starters {
    project_name: String,
    projects: HashMap<String, Vec<ContentFile>>,
    kinds: HashMap<String, FileTemplate>,
}

#[derive(Deserialize)]
struct Sample {
    id: String,
    title: String,
    name: String,
    style: String,
    blurb: String,
    #[serde(default)]
    group: String,
    #[serde(default)]
    shows: Vec<String>,
    #[serde(default)]
    accent: String,
    #[serde(default)]
    category: String,
    #[serde(default)]
    layout: String,
    #[serde(default)]
    needs: Vec<String>,
    files: Vec<ContentFile>,
}

fn starters() -> &'static Starters {
    static STARTERS: OnceLock<Starters> = OnceLock::new();
    STARTERS.get_or_init(|| serde_json::from_str(STARTERS_JSON).expect("content/starters.json"))
}

fn all_samples() -> &'static [Sample] {
    static SAMPLES: OnceLock<Vec<Sample>> = OnceLock::new();
    SAMPLES.get_or_init(|| {
        let mut all: Vec<Sample> =
            serde_json::from_str(SAMPLES_JSON).expect("content/samples.json");
        let Some(dir) = gallery_dir() else {
            eprintln!("HTML Lab: no gallery folder, so no templates");
            return all;
        };
        let path = dir.join("templates.json");
        match std::fs::read_to_string(&path).map(|text| serde_json::from_str::<Vec<Sample>>(&text)) {
            Ok(Ok(templates)) => all.extend(templates),
            Ok(Err(e)) => eprintln!("{}: {e}", path.display()),
            Err(e) => eprintln!("{}: {e}", path.display()),
        }
        all
    })
}

fn help() -> &'static Value {
    static HELP: OnceLock<Value> = OnceLock::new();
    HELP.get_or_init(|| {
        let mut help: Value = serde_json::from_str(HELP_JSON).expect("content/help.json");
        for (name, text) in HELP_EXTRA {
            let extra: Value = serde_json::from_str(text).expect(name);
            if let (Some(topics), Some(more)) =
                (help["topics"].as_array_mut(), extra["topics"].as_array())
            {
                topics.extend(more.iter().cloned());
            }
        }
        help
    })
}

pub fn new_project(style: &str) -> Option<ProjectContent> {
    let starters = starters();
    let files = starters.projects.get(style)?;
    Some(ProjectContent {
        id: format!("new-{style}"),
        name: starters.project_name.clone(),
        files: files.clone(),
    })
}

pub fn new_file(kind: &str, stem: &str, css: Option<&str>) -> Option<NewFileContent> {
    if stem.is_empty() {
        return None;
    }
    let row = KINDS.iter().find(|k| k.id == kind)?;
    let template = starters().kinds.get(kind)?;
    let link = match (css, &template.link) {
        (Some(css), Some(line)) => line.replace("{{css}}", css),
        _ => String::new(),
    };
    Some(NewFileContent {
        file: format!("{stem}.{}", row.primary_ext),
        text: template
            .text
            .replace("{{link}}", &link)
            .replace("{{title}}", &title_from_stem(stem)),
    })
}

fn title_from_stem(stem: &str) -> String {
    let spaced = stem.replace('-', " ");
    let mut letters = spaced.chars();
    match letters.next() {
        Some(first) => first.to_uppercase().chain(letters).collect(),
        None => String::new(),
    }
}

pub fn samples() -> Vec<SampleSummary> {
    all_samples()
        .iter()
        .map(|sample| SampleSummary {
            id: sample.id.clone(),
            title: sample.title.clone(),
            blurb: sample.blurb.clone(),
            style: sample.style.clone(),
            group: sample.group.clone(),
            shows: sample.shows.clone(),
            accent: sample.accent.clone(),
            category: sample.category.clone(),
            layout: sample.layout.clone(),
            needs: sample.needs.clone(),
        })
        .collect()
}

pub fn open_sample(id: &str) -> Option<ProjectContent> {
    let sample = all_samples().iter().find(|s| s.id == id)?;
    Some(ProjectContent {
        id: sample.id.clone(),
        name: sample.name.clone(),
        files: sample.files.clone(),
    })
}

fn find_topic<'a>(help: &'a Value, id: &str) -> Option<&'a Value> {
    help.get("topics")?
        .as_array()?
        .iter()
        .find(|topic| topic.get("id").and_then(Value::as_str) == Some(id))
}

fn practice_from(topic: &Value) -> Option<ProjectContent> {
    Some(ProjectContent {
        id: topic.get("id")?.as_str()?.to_string(),
        name: topic.get("short")?.as_str()?.to_string(),
        files: serde_json::from_value(topic.get("files")?.clone()).ok()?,
    })
}

fn file_from(topic: &Value, file: &str) -> Option<String> {
    topic
        .get("files")?
        .as_array()?
        .iter()
        .find(|f| f.get("name").and_then(Value::as_str) == Some(file))?
        .get("code")?
        .as_str()
        .map(str::to_string)
}

fn index_of(help: &Value) -> Value {
    let topics: Vec<Value> = help
        .get("topics")
        .and_then(Value::as_array)
        .map(|topics| topics.as_slice())
        .unwrap_or_default()
        .iter()
        .map(|topic| {
            let fields: Map<String, Value> = INDEX_FIELDS
                .iter()
                .filter_map(|field| Some((field.to_string(), topic.get(*field)?.clone())))
                .collect();
            Value::Object(fields)
        })
        .collect();
    let groups = help
        .get("groups")
        .cloned()
        .unwrap_or_else(|| Value::Array(Vec::new()));
    serde_json::json!({ "groups": groups, "topics": topics })
}

pub fn open_practice(topic_id: &str) -> Option<ProjectContent> {
    practice_from(find_topic(help(), topic_id)?)
}

pub fn help_index() -> Value {
    index_of(help())
}

pub fn help_topic(id: &str) -> Option<Value> {
    find_topic(help(), id).cloned()
}

pub fn help_file(topic_id: &str, file: &str) -> Option<String> {
    file_from(find_topic(help(), topic_id)?, file)
}

pub fn help_bytes(topic_id: &str, file: &str) -> Option<Vec<u8>> {
    let topic = find_topic(help(), topic_id)?;
    let entry = topic
        .get("files")?
        .as_array()?
        .iter()
        .find(|f| f.get("name").and_then(Value::as_str) == Some(file))?;
    if entry.get("picture").and_then(Value::as_bool) == Some(true) {
        return picture(file).map(<[u8]>::to_vec);
    }
    entry
        .get("code")?
        .as_str()
        .map(|text| text.as_bytes().to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kinds::kind_for_name;
    use crate::project::tags;
    use serde_json::json;
    use std::collections::HashSet;

    const LESSON_FIELDS: [&str; 15] = [
        "id", "group", "kind", "title", "short", "keywords", "explain", "code", "legend", "result",
        "files", "insert", "turn", "bar", "more",
    ];
    const LIST_FIELDS: [&str; 6] = ["id", "group", "kind", "title", "keywords", "rows"];
    const RECIPE_FIELDS: [&str; 9] = [
        "id", "group", "kind", "section", "title", "short", "keywords", "explain", "ways",
    ];
    const GROUP_FIELDS: [&str; 6] = ["id", "title", "line", "tile", "color", "icon"];

    fn local_file(reference: &str) -> Option<&str> {
        let reference = reference.trim();
        if reference.is_empty() || reference.starts_with('#') || reference.starts_with("//") {
            return None;
        }
        if let Some((scheme, _)) = reference.split_once(':') {
            let looks_like_scheme = scheme.starts_with(|c: char| c.is_ascii_alphabetic())
                && scheme
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || "+-.".contains(c));
            if looks_like_scheme {
                return None;
            }
        }
        let name = reference.split(['?', '#']).next().unwrap_or("");
        Some(name.strip_prefix("./").unwrap_or(name))
    }

    fn broken_references<'a>(
        files: impl Iterator<Item = (&'a str, &'a str)> + Clone,
    ) -> Vec<String> {
        let names: HashSet<&str> = files.clone().map(|(name, _)| name).collect();
        let mut broken = Vec::new();
        for (name, code) in files {
            for tag in tags(code) {
                for attr in ["href", "src"] {
                    let Some(file) = tag.attr(attr).and_then(local_file) else {
                        continue;
                    };
                    if !names.contains(file) {
                        broken.push(format!("{name} points at {file}"));
                    }
                }
            }
        }
        broken
    }

    fn search(topics: &[Value], query: &str) -> Vec<String> {
        let query = query.to_lowercase();
        topics
            .iter()
            .filter(|topic| {
                let title = topic["title"].as_str().unwrap_or("");
                let keywords = topic["keywords"].as_str().unwrap_or("");
                format!("{title} {keywords}")
                    .to_lowercase()
                    .contains(&query)
            })
            .filter_map(|topic| topic["id"].as_str().map(str::to_string))
            .collect()
    }

    fn check_dashes(value: &Value, problems: &mut Vec<String>) {
        fn has_dash(text: &str) -> bool {
            text.contains('\u{2014}') || text.contains('\u{2013}')
        }
        match value {
            Value::String(text) if has_dash(text) => {
                problems.push(format!("em or en dash in: {text}"));
            }
            Value::Array(items) => items.iter().for_each(|item| check_dashes(item, problems)),
            Value::Object(fields) => {
                for (key, field) in fields {
                    if has_dash(key) {
                        problems.push(format!("em or en dash in key: {key}"));
                    }
                    check_dashes(field, problems);
                }
            }
            _ => {}
        }
    }

    fn check_language(id: &str, field: &str, block: &Value, problems: &mut Vec<String>) {
        let lang = block["lang"].as_str().unwrap_or("");
        if !KINDS.iter().any(|kind| kind.language == lang) {
            problems.push(format!(
                "{id}: {field} language \"{lang}\" is not in the kinds table"
            ));
        }
        if !block["text"].is_string() {
            problems.push(format!("{id}: {field} block has no text"));
        }
    }

    fn check_lesson(id: &str, topic: &Value, problems: &mut Vec<String>) {
        for field in ["short", "keywords", "explain", "turn", "bar", "more"] {
            if topic.get(field).is_some() && !topic[field].is_string() {
                problems.push(format!("{id}: {field} is not a string"));
            }
        }

        let code = topic["code"]
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or_default();
        if topic.get("code").is_some() && code.is_empty() {
            problems.push(format!("{id}: code is not a list of blocks"));
        }
        for block in code {
            check_language(id, "code", block, problems);
        }
        if topic.get("insert").is_some() {
            check_language(id, "insert", &topic["insert"], problems);
        }

        let code_text: String = code
            .iter()
            .filter_map(|block| block["text"].as_str())
            .collect::<Vec<_>>()
            .join("\n");
        if let Some(legend) = topic.get("legend") {
            let Some(legend) = legend.as_array() else {
                problems.push(format!("{id}: legend is not a list"));
                return;
            };
            if legend.is_empty() {
                problems.push(format!("{id}: legend is empty"));
            }
            for entry in legend {
                let word = entry["word"].as_str().unwrap_or("");
                if word.is_empty() || !code_text.contains(word) {
                    problems.push(format!("{id}: legend word \"{word}\" is not in the code"));
                }
            }
        }

        check_files_and_result(id, topic, problems);
    }

    fn check_recipe(id: &str, topic: &Value, problems: &mut Vec<String>) {
        let ways = topic["ways"]
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or_default();
        if topic.get("ways").is_some() && ways.is_empty() {
            problems.push(format!("{id}: ways is not a list with ways"));
        }
        for way in ways {
            let steps = way["steps"]
                .as_array()
                .map(Vec::as_slice)
                .unwrap_or_default();
            if steps.is_empty() {
                problems.push(format!("{id}: a way has no steps"));
            }
            for step in steps {
                if !step["say"].is_string() {
                    problems.push(format!("{id}: a step says nothing"));
                }
                if step.get("text").is_some() {
                    check_language(id, "step", step, problems);
                }
            }
        }
        check_files_and_result(id, topic, problems);
    }

    fn check_files_and_result(id: &str, topic: &Value, problems: &mut Vec<String>) {
        let files: Vec<(&str, &str)> = topic["files"]
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or_default()
            .iter()
            .map(|file| {
                (
                    file["name"].as_str().unwrap_or(""),
                    file["code"].as_str().unwrap_or(""),
                )
            })
            .collect();
        if topic.get("files").is_some() {
            if files.is_empty() {
                problems.push(format!("{id}: files is empty"));
            }
            if files.iter().any(|(name, _)| name.is_empty()) {
                problems.push(format!("{id}: a file has no name"));
            }
            let all = topic["files"]
                .as_array()
                .map(Vec::as_slice)
                .unwrap_or_default();
            if all
                .iter()
                .any(|file| !file["code"].is_string() && file["picture"] != true)
            {
                problems.push(format!("{id}: a file has no code"));
            }
            for file in all.iter().filter(|file| file["picture"] == true) {
                let name = file["name"].as_str().unwrap_or("");
                if picture(name).is_none() {
                    problems.push(format!("{id}: {name} is not a built-in picture"));
                }
                if file["hidden"] != true {
                    problems.push(format!("{id}: picture {name} is not hidden"));
                }
            }
            if !files
                .iter()
                .any(|(name, _)| kind_for_name(name).is_some_and(|kind| kind.is_page))
            {
                problems.push(format!("{id}: files holds no page"));
            }
            for broken in broken_references(files.iter().copied()) {
                problems.push(format!("{id}: {broken}, not in its files"));
            }
        }

        if let Some(result) = topic.get("result") {
            if !result["height"].is_number() {
                problems.push(format!("{id}: result has no height"));
            }
            let shown = result["files"].as_array();
            if shown.is_none_or(|shown| shown.is_empty()) {
                problems.push(format!("{id}: result shows no files"));
            }
            for name in shown.map(Vec::as_slice).unwrap_or_default() {
                let name = name.as_str().unwrap_or("");
                if !files.iter().any(|(file, _)| *file == name) {
                    problems.push(format!("{id}: result file \"{name}\" is not in its files"));
                }
            }
        }
    }

    fn check_list(id: &str, topic: &Value, problems: &mut Vec<String>) {
        if let Some(rows) = topic.get("rows") {
            let Some(rows) = rows.as_array().filter(|rows| !rows.is_empty()) else {
                problems.push(format!("{id}: rows is not a list with rows"));
                return;
            };
            for row in rows {
                if !row["code"].is_string() || !row["means"].is_string() {
                    problems.push(format!("{id}: a row needs code and means"));
                }
            }
            if let Some(lang) = topic.get("lang") {
                let lang = lang.as_str().unwrap_or("");
                if lang != "html" && lang != "css" {
                    problems.push(format!("{id}: lang \"{lang}\" is not html or css"));
                }
                for row in rows {
                    let code = row["code"].as_str().unwrap_or("");
                    let means = row["means"].as_str().unwrap_or("?");
                    if code.trim().is_empty() || means.trim().is_empty() {
                        problems.push(format!("{id}: \"{means}\" needs a task and its code"));
                    }
                    if lang == "css" && !code.contains('{') {
                        problems.push(format!("{id}: \"{means}\" is not whole CSS rules to paste into style.css"));
                    }
                    if row.get("tip").is_some_and(|tip| !tip.is_string()) {
                        problems.push(format!("{id}: \"{means}\" has a tip that is not text"));
                    }
                }
            }
        }
    }

    fn check_help(help: &Value) -> Vec<String> {
        let mut problems = Vec::new();
        check_dashes(help, &mut problems);

        let groups = help["groups"]
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or_default();
        let topics = help["topics"]
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or_default();
        if !help["groups"].is_array() {
            problems.push("groups is not a list".to_string());
        }
        if !help["topics"].is_array() {
            problems.push("topics is not a list".to_string());
        }

        let mut group_ids = HashSet::new();
        for group in groups {
            let id = group["id"].as_str().unwrap_or("?");
            for field in GROUP_FIELDS {
                if group.get(field).is_none_or(Value::is_null) {
                    problems.push(format!("group {id}: missing {field}"));
                }
            }
            if !group_ids.insert(id) {
                problems.push(format!("group {id}: id is not unique"));
            }
        }

        let mut topic_ids = HashSet::new();
        for topic in topics {
            let id = topic["id"].as_str().unwrap_or("?");
            if !topic_ids.insert(id) {
                problems.push(format!("{id}: id is not unique"));
            }

            let kind = topic["kind"].as_str().unwrap_or("");
            let fields: &[&str] = match kind {
                "lesson" => &LESSON_FIELDS,
                "list" => &LIST_FIELDS,
                "recipe" => &RECIPE_FIELDS,
                _ => {
                    problems.push(format!(
                        "{id}: kind \"{kind}\" is not lesson, list or recipe"
                    ));
                    continue;
                }
            };
            for field in fields {
                if topic.get(*field).is_none_or(Value::is_null) {
                    problems.push(format!("{id}: missing {field}"));
                }
            }

            let group = topic["group"].as_str().unwrap_or("");
            if topic.get("group").is_some() && !group_ids.contains(group) {
                problems.push(format!("{id}: group \"{group}\" does not exist"));
            }

            let keywords = topic["keywords"].as_str().unwrap_or("");
            if keywords.trim().is_empty() {
                problems.push(format!("{id}: no keywords to search by"));
            }
            for keyword in keywords.split_whitespace() {
                if !search(topics, keyword).iter().any(|found| found == id) {
                    problems.push(format!("{id}: search does not find it by \"{keyword}\""));
                }
            }

            match kind {
                "lesson" => check_lesson(id, topic, &mut problems),
                "recipe" => {
                    check_recipe(id, topic, &mut problems);
                    if let Some(learn) = topic["learn"].as_str() {
                        let is_lesson = topics
                            .iter()
                            .any(|t| t["id"] == learn && t["kind"] == "lesson");
                        if !is_lesson {
                            problems.push(format!("{id}: learn \"{learn}\" is not a lesson"));
                        }
                    }
                }
                _ => check_list(id, topic, &mut problems),
            }
        }
        problems
    }

    fn good_help() -> Value {
        json!({
            "groups": [
                { "id": "ways", "title": "Three ways", "line": "A line", "tile": "#E1EBFD",
                  "color": "#1D56C9", "icon": "add-css" },
                { "id": "lookup", "title": "Look-up lists", "line": "A line", "tile": "#E4EAF2",
                  "color": "#4A5A73", "icon": "lookup" }
            ],
            "topics": [
                {
                    "id": "style-file",
                    "group": "ways",
                    "kind": "lesson",
                    "title": "Style file: change many pages",
                    "short": "Style file",
                    "keywords": "style.css link external color",
                    "explain": "Keep your style in its own file.",
                    "code": [
                        { "lang": "html", "text": "<link rel=\"stylesheet\" href=\"style.css\">" },
                        { "lang": "css", "text": "h1 { color: purple; }" }
                    ],
                    "legend": [
                        { "word": "\"style.css\"", "tint": "a", "means": "is the file to use" },
                        { "word": "color: purple;", "tint": "b", "means": "is the new look" }
                    ],
                    "result": { "files": ["home.html", "planets.html"], "height": 72 },
                    "files": [
                        { "name": "home.html", "hidden": false, "code":
                            "<link rel=\"stylesheet\" href=\"style.css\"><a href=\"planets.html#top\">x</a><img src=\"sun.svg\" alt=\"\">" },
                        { "name": "planets.html", "hidden": false, "code":
                            "<a href=\"home.html\">x</a><a href=\"https://example.com/a.html\">y</a><a href=\"http://example.com\">z</a><a href=\"#top\">j</a><a href=\"mailto:a@example.com\">m</a>" },
                        { "name": "style.css", "hidden": false, "code": "h1 { color: purple; }\n" },
                        { "name": "sun.svg", "hidden": true, "code": "<svg></svg>\n" }
                    ],
                    "insert": { "lang": "html", "text": "<link rel=\"stylesheet\" href=\"style.css\">" },
                    "turn": "change purple to teal in style.css.",
                    "bar": "change **purple** to **teal** in style.css.",
                    "more": "https://developer.mozilla.org/en-US/docs/Web/HTML/Element/link"
                },
                {
                    "id": "html-tags",
                    "group": "lookup",
                    "kind": "list",
                    "title": "HTML tags",
                    "keywords": "tag list",
                    "rows": [ { "code": "<h1>", "means": "A big heading", "color": null } ]
                }
            ]
        })
    }

    fn problems_after(change: impl FnOnce(&mut Value)) -> Vec<String> {
        let mut help = good_help();
        change(&mut help);
        check_help(&help)
    }

    fn assert_flags(change: impl FnOnce(&mut Value), expected: &str) {
        let problems = problems_after(change);
        assert!(
            problems.iter().any(|p| p.contains(expected)),
            "wanted \"{expected}\" in {problems:?}"
        );
    }

    fn remove_field(topic: &mut Value, field: &str) {
        topic.as_object_mut().unwrap().remove(field);
    }

    #[test]
    fn help_check_passes_the_good_fixture() {
        assert_eq!(check_help(&good_help()), Vec::<String>::new());
    }

    #[test]
    fn help_check_wants_every_lesson_field() {
        for field in LESSON_FIELDS {
            let problems = problems_after(|help| remove_field(&mut help["topics"][0], field));
            assert!(!problems.is_empty(), "{field}");
        }
        for field in [
            "explain", "turn", "bar", "more", "insert", "legend", "code", "files", "result",
        ] {
            assert_flags(
                |help| remove_field(&mut help["topics"][0], field),
                &format!("missing {field}"),
            );
        }
    }

    #[test]
    fn help_check_counts_null_as_missing() {
        assert_flags(
            |help| help["topics"][0]["insert"] = Value::Null,
            "missing insert",
        );
    }

    #[test]
    fn help_check_wants_every_list_field() {
        for field in LIST_FIELDS {
            let problems = problems_after(|help| remove_field(&mut help["topics"][1], field));
            assert!(!problems.is_empty(), "{field}");
        }
        assert_flags(
            |help| remove_field(&mut help["topics"][1], "rows"),
            "missing rows",
        );
        assert_flags(|help| help["topics"][1]["rows"] = json!([]), "rows");
        assert_flags(
            |help| help["topics"][1]["rows"] = json!([{ "code": "<p>" }]),
            "needs code and means",
        );
    }

    #[test]
    fn help_check_looks_inside_a_recipe() {
        let recipe = |ways: Value, learn: &str| {
            json!({
                "groups": [
                    { "id": "recipes", "title": "I want to", "line": "A line", "tile": "#FEF3C7",
                      "color": "#B45309", "icon": "recipes" }
                ],
                "topics": [
                    { "id": "r", "group": "recipes", "kind": "recipe", "section": "Text", "title": "Red",
                      "short": "Red", "keywords": "red", "explain": "Red.", "learn": learn, "ways": ways }
                ]
            })
        };
        let good = json!([{ "title": "", "steps": [{ "say": "Put this.", "lang": "html", "text": "<p></p>" }] }]);
        let problems = check_help(&recipe(good, "nowhere"));
        assert_eq!(problems, ["r: learn \"nowhere\" is not a lesson"]);

        let no_steps = json!([{ "title": "", "steps": [] }]);
        assert!(check_help(&recipe(no_steps, ""))
            .iter()
            .any(|p| p.contains("a way has no steps")));
        let silent = json!([{ "title": "", "steps": [{ "lang": "html", "text": "x" }] }]);
        assert!(check_help(&recipe(silent, ""))
            .iter()
            .any(|p| p.contains("a step says nothing")));
        let wrong_language =
            json!([{ "title": "", "steps": [{ "say": "x", "lang": "ruby", "text": "x" }] }]);
        assert!(!check_help(&recipe(wrong_language, ""))
            .iter()
            .all(|p| p.contains("learn")));
    }

    #[test]
    fn a_how_list_holds_code_to_copy_in_one_language() {
        fn how(rows: Value, lang: &'static str) -> impl FnOnce(&mut Value) {
            move |h: &mut Value| {
                let list = &mut h["topics"][1];
                list["lang"] = json!(lang);
                list["rows"] = rows;
            }
        }
        let good = json!([{ "means": "Make the words red", "code": "h1 {\n  color: red;\n}", "tip": "Any **color**." }]);
        assert_eq!(problems_after(how(good, "css")), Vec::<String>::new());
        let bare = json!([{ "means": "Make the words red", "code": "color: red;" }]);
        assert_flags(how(bare, "css"), "is not whole CSS rules");
        let empty = json!([{ "means": "Show a picture", "code": " " }]);
        assert_flags(how(empty, "html"), "needs a task and its code");
        let ruby = json!([{ "means": "x", "code": "x" }]);
        assert_flags(how(ruby, "ruby"), "is not html or css");
        let tip = json!([{ "means": "x", "code": "<p>x</p>", "tip": 3 }]);
        assert_flags(how(tip, "html"), "has a tip that is not text");
    }

    #[test]
    fn help_check_wants_a_known_kind() {
        assert_flags(
            |help| help["topics"][0]["kind"] = json!("essay"),
            "not lesson, list or recipe",
        );
    }

    #[test]
    fn help_check_wants_group_fields() {
        for field in GROUP_FIELDS {
            assert_flags(
                |help| remove_field(&mut help["groups"][0], field),
                &format!("missing {field}"),
            );
        }
    }

    #[test]
    fn help_check_wants_unique_ids() {
        assert_flags(
            |help| help["topics"][1]["id"] = json!("style-file"),
            "not unique",
        );
        assert_flags(|help| help["groups"][1]["id"] = json!("ways"), "not unique");
    }

    #[test]
    fn help_check_wants_groups_that_exist() {
        assert_flags(
            |help| help["topics"][0]["group"] = json!("nope"),
            "does not exist",
        );
    }

    #[test]
    fn help_check_finds_a_broken_href() {
        assert_flags(
            |help| help["topics"][0]["files"][0]["code"] = json!("<a href=\"nope.html\">x</a>"),
            "points at nope.html",
        );
        assert_flags(
            |help| {
                help["topics"][0]["files"][0]["code"] =
                    json!("<link rel=\"stylesheet\" href=\"nope.css\">");
            },
            "points at nope.css",
        );
    }

    #[test]
    fn help_check_finds_a_broken_src() {
        assert_flags(
            |help| help["topics"][0]["files"][0]["code"] = json!("<img src=\"nope.png\" alt=\"\">"),
            "points at nope.png",
        );
    }

    #[test]
    fn help_check_ignores_addresses_jumps_and_mail() {
        let problems = problems_after(|help| {
            help["topics"][0]["files"][0]["code"] = json!(
                "<a href=\"http://example.com/a.html\">a</a>\
                 <a href=\"https://example.com/b.html\">b</a>\
                 <a href=\"#top\">c</a>\
                 <a href=\"mailto:a@example.com\">d</a>\
                 <img src=\"https://example.com/c.png\" alt=\"\">\
                 <!-- <a href=\"only-a-comment.html\">e</a> -->"
            );
        });
        assert_eq!(problems, Vec::<String>::new());
    }

    #[test]
    fn help_check_wants_result_files_in_files() {
        assert_flags(
            |help| help["topics"][0]["result"]["files"] = json!(["home.html", "nope.html"]),
            "result file \"nope.html\"",
        );
        assert_flags(
            |help| help["topics"][0]["result"]["files"] = json!([]),
            "shows no files",
        );
        assert_flags(
            |help| remove_field(&mut help["topics"][0]["result"], "height"),
            "no height",
        );
    }

    #[test]
    fn help_check_wants_languages_from_the_kinds_table() {
        assert_flags(
            |help| help["topics"][0]["code"][0]["lang"] = json!("python"),
            "code language \"python\"",
        );
        assert_flags(
            |help| help["topics"][0]["insert"]["lang"] = json!("js"),
            "insert language \"js\"",
        );
    }

    #[test]
    fn help_check_wants_legend_words_in_the_code() {
        assert_flags(
            |help| help["topics"][0]["legend"][1]["word"] = json!("color: red;"),
            "legend word \"color: red;\"",
        );
        let problems = problems_after(|help| {
            help["topics"][0]["legend"][0]["word"] = json!("h1 { color");
        });
        assert_eq!(problems, Vec::<String>::new());
        assert_flags(
            |help| help["topics"][0]["legend"][0]["word"] = json!("planets.html"),
            "legend word \"planets.html\"",
        );
        assert_flags(|help| help["topics"][0]["legend"] = json!([]), "legend is empty");
    }

    #[test]
    fn help_check_finds_em_and_en_dashes_anywhere() {
        assert_flags(
            |help| help["topics"][0]["explain"] = json!("Keep \u{2014} your style."),
            "em or en dash",
        );
        assert_flags(
            |help| help["topics"][0]["files"][2]["code"] = json!("/* 1\u{2013}2 */"),
            "em or en dash",
        );
        assert_flags(
            |help| help["groups"][0]["line"] = json!("A \u{2013} line"),
            "em or en dash",
        );
        assert_flags(
            |help| help["topics"][1]["rows"][0]["means"] = json!("Big \u{2014} heading"),
            "em or en dash",
        );
    }

    #[test]
    fn help_check_wants_keywords_to_search_by() {
        assert_flags(
            |help| help["topics"][0]["keywords"] = json!("   "),
            "no keywords",
        );
    }

    #[test]
    fn help_search_finds_by_title_and_keywords_in_any_case() {
        let help = good_help();
        let topics = help["topics"].as_array().unwrap();
        assert_eq!(search(topics, "STYLE.css"), ["style-file"]);
        assert_eq!(search(topics, "many pages"), ["style-file"]);
        assert_eq!(search(topics, "tag"), ["html-tags"]);
        assert!(search(topics, "zebra").is_empty());
    }

    #[test]
    fn help_check_wants_a_page_in_each_lesson() {
        assert_flags(
            |help| {
                help["topics"][0]["files"] =
                    json!([{ "name": "style.css", "code": "", "hidden": false }]);
                help["topics"][0]["result"]["files"] = json!(["style.css"]);
            },
            "files holds no page",
        );
    }

    #[test]
    fn the_real_help_file_passes_every_check() {
        let own: Value = serde_json::from_str(HELP_JSON).expect("content/help.json is valid JSON");
        assert_eq!(
            own["topics"].as_array().expect("topics").len(),
            69,
            "topics in content/help.json"
        );
        let help = help().clone();
        let groups = help["groups"].as_array().expect("groups");
        let ids: Vec<&str> = groups.iter().filter_map(|g| g["id"].as_str()).collect();
        assert_eq!(
            ids,
            ["start", "recipes", "html", "ways", "css", "design", "effects", "lookup"]
        );
        for (file, group, section) in [
            (HELP_DESIGN_JSON, "design", "Design"),
            (HELP_EFFECTS_JSON, "effects", "Effects"),
        ] {
            let extra: Value = serde_json::from_str(file).expect("extra help file");
            let in_file = extra["topics"].as_array().expect("topics");
            assert!(
                in_file.iter().any(|t| t["group"] == group),
                "{group}: its file holds none of its own lessons"
            );
            assert!(
                in_file.iter().all(|t| t["group"] == group || t["section"] == section),
                "{group}: a topic of another group"
            );
            let all = help["topics"]
                .as_array()
                .expect("topics")
                .iter()
                .filter(|t| t["group"] == group || t["section"] == section)
                .count();
            assert_eq!(all, in_file.len(), "{group}: topics outside its own file");
        }
        let problems = check_help(&help);
        assert!(
            problems.is_empty(),
            "problems in content/help.json:\n{}",
            problems.join("\n")
        );
    }

    #[test]
    fn every_real_topic_works_through_the_public_functions() {
        let help = help().clone();
        let empty = Vec::new();
        let topics = help["topics"].as_array().expect("topics is a list");
        assert!(!topics.is_empty(), "no topics");
        for topic in topics {
            let id = topic["id"].as_str().unwrap_or("");
            assert_eq!(help_topic(id).as_ref(), Some(topic));
            if topic["kind"] == "lesson" {
                let practice = open_practice(id).unwrap();
                assert_eq!(practice.id, id);
                assert_eq!(practice.name, topic["short"].as_str().unwrap());
                for file in &practice.files {
                    if file.picture {
                        assert_eq!(help_bytes(id, &file.name).as_deref(), picture(&file.name));
                    } else {
                        assert_eq!(help_file(id, &file.name).as_ref(), Some(&file.code));
                    }
                }
            } else if topic["kind"] == "recipe" {
                for file in topic["files"].as_array().unwrap_or(&empty) {
                    let name = file["name"].as_str().unwrap();
                    assert_eq!(help_file(id, name).as_deref(), file["code"].as_str());
                }
            } else {
                assert_eq!(open_practice(id), None);
            }
        }
    }

    #[test]
    fn public_help_functions_answer_none_for_unknown_ids() {
        assert_eq!(help_topic("no-such-topic"), None);
        assert_eq!(open_practice("no-such-topic"), None);
        assert_eq!(help_file("no-such-topic", "a.html"), None);
        assert!(help_index()["groups"].is_array());
        assert!(help_index()["topics"].is_array());
    }

    #[test]
    fn practice_comes_from_the_topics_files() {
        let help = good_help();
        let topic = find_topic(&help, "style-file").unwrap();
        let practice = practice_from(topic).unwrap();
        assert_eq!(practice.id, "style-file");
        assert_eq!(practice.name, "Style file");
        let names: Vec<&str> = practice.files.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(names, ["home.html", "planets.html", "style.css", "sun.svg"]);
        assert!(!practice.files[0].hidden);
        assert!(practice.files[3].hidden);
        assert!(practice_from(find_topic(&help, "html-tags").unwrap()).is_none());
    }

    #[test]
    fn help_file_serves_any_file_hidden_too() {
        let help = good_help();
        let topic = find_topic(&help, "style-file").unwrap();
        assert_eq!(
            file_from(topic, "sun.svg").as_deref(),
            Some("<svg></svg>\n")
        );
        assert_eq!(
            file_from(topic, "style.css").as_deref(),
            Some("h1 { color: purple; }\n")
        );
        assert_eq!(file_from(topic, "nope.html"), None);
        assert_eq!(
            file_from(find_topic(&help, "html-tags").unwrap(), "a.html"),
            None
        );
    }

    #[test]
    fn help_index_holds_no_lesson_bodies() {
        let help = good_help();
        let index = index_of(&help);
        assert_eq!(index["groups"], help["groups"]);
        let lesson = index["topics"][0].as_object().unwrap();
        let mut keys: Vec<&str> = lesson.keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(keys, ["group", "id", "keywords", "kind", "short", "title"]);
        assert_eq!(lesson["short"], "Style file");
        let list = index["topics"][1].as_object().unwrap();
        assert_eq!(list["id"], "html-tags");
        assert!(!list.contains_key("rows"));
        assert!(!list.contains_key("short"));
        assert_eq!(index["topics"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn a_practice_file_with_no_hidden_key_is_not_hidden() {
        let file: ContentFile = serde_json::from_str(r#"{ "name": "a", "code": "b" }"#).unwrap();
        assert!(!file.hidden);
    }

    fn file<'a>(project: &'a ProjectContent, name: &str) -> &'a ContentFile {
        project.files.iter().find(|f| f.name == name).unwrap()
    }

    #[test]
    fn new_project_inline_has_one_page_with_its_style_in_a_tag() {
        let project = new_project("inline").unwrap();
        assert_eq!(project.name, "My new page");
        assert_eq!(project.id, "new-inline");
        assert_eq!(project.files.len(), 1);
        assert_eq!(
            file(&project, "my-page.html").code,
            "<!doctype html>\n<html>\n  <head>\n    <meta charset=\"utf-8\">\n    <title>My new page</title>\n  </head>\n  <body>\n    <h1 style=\"color: teal;\">My new page</h1>\n    <p>Write something here.</p>\n  </body>\n</html>\n"
        );
    }

    #[test]
    fn new_project_file_has_a_page_and_a_style_file() {
        let project = new_project("file").unwrap();
        assert_eq!(project.name, "My new page");
        assert_eq!(project.id, "new-file");
        assert_eq!(project.files.len(), 2);
        assert_eq!(
            file(&project, "my-page.html").code,
            "<!doctype html>\n<html>\n  <head>\n    <meta charset=\"utf-8\">\n    <title>My new page</title>\n    <link rel=\"stylesheet\" href=\"style.css\">\n  </head>\n  <body>\n    <h1>My new page</h1>\n    <p>Write something here.</p>\n  </body>\n</html>\n"
        );
        assert_eq!(
            file(&project, "style.css").code,
            "h1 {\n  color: teal;\n}\n"
        );
    }

    #[test]
    fn new_project_of_an_unknown_style_is_none() {
        assert_eq!(new_project("nope"), None);
    }

    const PLANETS_WITH_LINK: &str = "<!doctype html>\n<html>\n  <head>\n    <meta charset=\"utf-8\">\n    <title>Planets</title>\n    <link rel=\"stylesheet\" href=\"style.css\">\n  </head>\n  <body>\n    <h1>Planets</h1>\n    <p>Write something here.</p>\n  </body>\n</html>\n";

    #[test]
    fn new_file_page_with_a_link() {
        let made = new_file("html", "planets", Some("style.css")).unwrap();
        assert_eq!(made.file, "planets.html");
        assert_eq!(made.text, PLANETS_WITH_LINK);
    }

    #[test]
    fn new_file_page_without_a_link_loses_exactly_that_line() {
        let made = new_file("html", "planets", None).unwrap();
        assert_eq!(made.file, "planets.html");
        assert_eq!(
            made.text,
            PLANETS_WITH_LINK.replace("    <link rel=\"stylesheet\" href=\"style.css\">\n", "")
        );
        assert!(!made.text.contains("{{"));
    }

    #[test]
    fn new_file_links_the_css_file_it_is_given() {
        let made = new_file("html", "planets", Some("more-style.css")).unwrap();
        assert!(made
            .text
            .contains("<link rel=\"stylesheet\" href=\"more-style.css\">"));
    }

    #[test]
    fn new_file_makes_the_title_from_the_stem() {
        let made = new_file("html", "my-cool-page", None).unwrap();
        assert_eq!(made.file, "my-cool-page.html");
        assert!(made.text.contains("<title>My cool page</title>"));
        assert!(made.text.contains("<h1>My cool page</h1>"));
    }

    #[test]
    fn new_file_css_is_the_starter_style_file() {
        let made = new_file("css", "more-style", None).unwrap();
        assert_eq!(made.file, "more-style.css");
        assert_eq!(
            made.text,
            file(&new_project("file").unwrap(), "style.css").code
        );
        assert_eq!(
            new_file("css", "more-style", Some("x.css")).unwrap().text,
            made.text
        );
    }

    #[test]
    fn new_file_answers_none_for_an_unknown_kind_or_no_stem() {
        assert_eq!(new_file("markdown", "planets", None), None);
        assert_eq!(new_file("html", "", None), None);
    }

    #[test]
    fn every_kind_has_a_template() {
        for kind in KINDS {
            let made = new_file(kind.id, kind.default_stem, None).unwrap();
            assert_eq!(
                made.file,
                format!("{}.{}", kind.default_stem, kind.primary_ext)
            );
            assert!(!made.text.is_empty());
            assert!(!made.text.contains("{{"));
        }
    }

    #[test]
    fn samples_come_in_the_new_dialogs_order_with_its_wording() {
        let rows: Vec<(String, String, String, String)> = samples()
            .into_iter()
            .filter(|s| s.group.is_empty())
            .map(|s| (s.id, s.title, s.blurb, s.style))
            .collect();
        let expected = [
            (
                "space-poster",
                "Space poster",
                "Style inside the page. 1 file.",
                "inline",
            ),
            (
                "space-club",
                "Space club website",
                "Style in a separate file. 2 pages and 1 style file.",
                "file",
            ),
            (
                "my-hobby",
                "My hobby page",
                "Style block inside the page. 1 file.",
                "inline",
            ),
            (
                "pancakes",
                "Pancake recipe",
                "Style in a separate file. 1 page and 1 style file.",
                "file",
            ),
            (
                "gallery",
                "Photo gallery",
                "Style in a separate file, with 3 pictures.",
                "file",
            ),
        ];
        assert_eq!(rows.len(), expected.len());
        for (row, want) in rows.iter().zip(expected) {
            assert_eq!(
                (
                    row.0.as_str(),
                    row.1.as_str(),
                    row.2.as_str(),
                    row.3.as_str()
                ),
                want
            );
        }
    }

    #[test]
    fn every_sample_opens_with_its_project_name_and_files() {
        let expected = [
            ("space-poster", "Space poster", vec!["my-page.html"]),
            (
                "space-club",
                "Space club",
                vec!["my-page.html", "planets.html", "style.css"],
            ),
            ("my-hobby", "My hobby", vec!["my-page.html"]),
            ("pancakes", "Pancakes", vec!["recipe.html", "style.css"]),
            (
                "gallery",
                "My gallery",
                vec![
                    "gallery.html",
                    "style.css",
                    "sun.jpg",
                    "tree.jpg",
                    "boat.jpg",
                ],
            ),
        ];
        for (id, name, files) in expected {
            let project = open_sample(id).unwrap();
            assert_eq!(project.id, id);
            assert_eq!(project.name, name);
            let names: Vec<&str> = project.files.iter().map(|f| f.name.as_str()).collect();
            assert_eq!(names, files, "{id}");
        }
    }

    #[test]
    fn every_built_in_picture_is_a_small_jpeg_with_a_source() {
        let sources = include_str!("../content/pictures/SOURCES.md");
        for (name, bytes) in PICTURES {
            assert!(
                bytes.starts_with(&[0xFF, 0xD8, 0xFF]),
                "{name} is not a JPEG"
            );
            assert!(bytes.len() < 40 * 1024, "{name} is {} bytes", bytes.len());
            assert!(
                sources.contains(&format!("| {name} |")),
                "{name} has no source row"
            );
        }
        assert_eq!(picture("nope.jpg"), None);
    }

    #[test]
    fn every_picture_a_sample_names_is_built_in() {
        for summary in samples() {
            for file in open_sample(&summary.id).unwrap().files {
                if file.picture {
                    assert!(
                        picture(&file.name).is_some(),
                        "{}/{}",
                        summary.id,
                        file.name
                    );
                    assert!(file.code.is_empty(), "{}/{}", summary.id, file.name);
                }
            }
        }
    }

    fn templates() -> Vec<SampleSummary> {
        let path = gallery_dir().expect("a gallery folder").join("templates.json");
        let text = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("{}: {e}", path.display()));
        let packed: Vec<Value> =
            serde_json::from_str(&text).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
        let list: Vec<SampleSummary> = samples()
            .into_iter()
            .filter(|s| s.group == "template")
            .collect();
        assert!(!list.is_empty(), "{}: no templates loaded", path.display());
        assert_eq!(list.len(), packed.len(), "{}: not every template loaded", path.display());
        list
    }

    #[test]
    fn every_template_has_its_gallery_fields() {
        for t in templates() {
            assert!(t.id.starts_with("template-"), "{}", t.id);
            assert!(
                !t.title.is_empty() && t.blurb.chars().count() < 70,
                "{}",
                t.id
            );
            assert!((3..=5).contains(&t.shows.len()), "{}", t.id);
            assert!(
                t.shows.iter().all(|line| line.chars().count() < 48),
                "{}",
                t.id
            );
            assert!(
                t.accent.len() == 7 && t.accent.starts_with('#'),
                "{}: accent {}",
                t.id,
                t.accent
            );
        }
        for s in samples().into_iter().filter(|s| s.group.is_empty()) {
            assert!(
                s.shows.is_empty() && s.accent.is_empty() && s.category.is_empty() && s.layout.is_empty(),
                "{}",
                s.id
            );
        }
    }

    const CATEGORIES: [&str; 6] = ["fun", "professional", "industrial", "creative", "science", "effects"];

    #[test]
    fn every_template_has_a_filter_and_its_own_layout() {
        let all = templates();
        assert!(all.len() >= 6, "{} templates", all.len());
        let mut layouts = std::collections::HashSet::new();
        let mut last = 0;
        for t in &all {
            let at = CATEGORIES.iter().position(|c| *c == t.category);
            let at = at.unwrap_or_else(|| panic!("{}: category {:?}", t.id, t.category));
            assert!(at >= last, "{} is out of order", t.id);
            last = at;
            assert!(
                !t.layout.is_empty() && t.layout.chars().count() <= 60,
                "{}: layout {:?}",
                t.id,
                t.layout
            );
            assert!(layouts.insert(t.layout.clone()), "{}: layout used twice", t.id);
        }
    }

    #[test]
    fn every_template_opens_every_page_and_its_style_as_tabs() {
        for t in templates() {
            let project = open_sample(&t.id).unwrap();
            let shown: Vec<&str> = project
                .files
                .iter()
                .filter(|f| !f.hidden)
                .map(|f| f.name.as_str())
                .collect();
            let pages = project
                .files
                .iter()
                .filter(|f| f.name.ends_with(".html"))
                .count();
            assert!(pages >= 3, "{}: {pages} pages", t.id);
            assert_eq!(shown[..2], ["index.html", "style.css"], "{}", t.id);
            assert_eq!(shown.len(), pages + 1, "{}: every page is a tab", t.id);
            let home = &project.files[0].code;
            let place = |name: &str| {
                home.find(&format!("href=\"{name}\""))
                    .unwrap_or_else(|| panic!("{}: index.html does not link {name}", t.id))
            };
            for name in &shown[2..] {
                place(name);
            }
            for pair in shown[2..].windows(2) {
                assert!(place(pair[0]) <= place(pair[1]), "{}: {pair:?} not in menu order", t.id);
            }
            for file in project.files.iter().filter(|f| f.hidden) {
                let drawing = file.picture || file.name.ends_with(".svg");
                assert!(drawing, "{}/{} is hidden but not a picture", t.id, file.name);
            }
            for page in project.files.iter().filter(|f| f.name.ends_with(".html")) {
                assert!(
                    page.code.contains("href=\"style.css\""),
                    "{}/{} has no style.css link",
                    t.id,
                    page.name
                );
            }
        }
    }

    #[test]
    fn every_template_picture_is_small_used_and_has_a_source() {
        let dir = gallery_dir().unwrap();
        let sources = std::fs::read_to_string(dir.join("SOURCES.md"))
            .unwrap_or_else(|e| panic!("{}: {e}", dir.join("SOURCES.md").display()));
        let mut used = std::collections::HashSet::new();
        for t in templates() {
            for file in open_sample(&t.id).unwrap().files.iter().filter(|f| f.picture) {
                assert!(picture(&file.name).is_some(), "{}/{}", t.id, file.name);
                used.insert(file.name.clone());
            }
        }
        for entry in std::fs::read_dir(dir.join("pictures")).unwrap() {
            let path = entry.unwrap().path();
            let name = path.file_name().unwrap().to_str().unwrap().to_string();
            let bytes = std::fs::read(&path).unwrap();
            let jpeg = bytes.starts_with(&[0xFF, 0xD8, 0xFF]);
            let png = bytes.starts_with(&[0x89, b'P', b'N', b'G']);
            assert!(jpeg || png, "{name} is not a JPEG or PNG");
            assert!(plain_picture_name(&name), "{name}");
            assert!(bytes.len() < 100 * 1024, "{name} is {} bytes", bytes.len());
            assert!(sources.contains(&format!("| {name} |")), "{name} has no source row");
            assert!(used.contains(&name), "{name} is not used by any template");
        }
    }

    #[test]
    fn every_template_has_its_gallery_pictures() {
        let dir = gallery_dir().unwrap();
        let mut ids = HashSet::new();
        for t in templates() {
            let id = t.id.trim_start_matches("template-");
            ids.insert(id.to_string());
            for (folder, limit) in [("previews", 60 * 1024), ("thumbs", 8 * 1024)] {
                let path = dir.join(folder).join(format!("{id}.webp"));
                let bytes = std::fs::read(&path).unwrap_or_else(|_| panic!("{}", path.display()));
                assert!(bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP"), "{} is not WebP", path.display());
                assert!(bytes.len() < limit, "{} is {} bytes", path.display(), bytes.len());
            }
        }
        for folder in ["previews", "thumbs"] {
            for entry in std::fs::read_dir(dir.join(folder)).unwrap() {
                let path = entry.unwrap().path();
                let name = path.file_name().unwrap().to_str().unwrap();
                let stem = name.strip_suffix(".webp").unwrap_or(name);
                if !name.starts_with('.') {
                    assert!(ids.contains(stem), "{} belongs to no template", path.display());
                }
            }
        }
    }

    #[test]
    fn a_gallery_picture_name_cannot_leave_its_folder() {
        for bad in ["../x.jpg", "..jpg", "a/b.jpg", "A.jpg", "x.gif", ".jpg", "x", "x.jpg/"] {
            assert!(!plain_picture_name(bad), "{bad}");
            assert_eq!(gallery_picture(bad), None, "{bad}");
        }
        assert!(plain_picture_name("dino-hero.jpg"));
        assert!(gallery_image("/previews/dino.webp").is_some());
        assert!(gallery_image("/thumbs/dino.webp").is_some());
        for bad in ["/pictures/dino-hero.jpg", "/previews/../templates.json", "previews/dino.jpg", "/previews/x/dino.jpg", "/SOURCES.md"] {
            assert_eq!(gallery_image(bad), None, "{bad}");
        }
    }

    #[test]
    fn help_bytes_serves_text_files_and_built_in_photos() {
        let photo = help_bytes("pictures", "saturn.jpg").unwrap();
        assert_eq!(photo, picture("saturn.jpg").unwrap());
        let page = help_bytes("pictures", "my-page.html").unwrap();
        assert_eq!(
            page,
            help_file("pictures", "my-page.html").unwrap().into_bytes()
        );
        assert_eq!(help_bytes("pictures", "nope.jpg"), None);
        assert_eq!(help_bytes("nope", "saturn.jpg"), None);
    }

    #[test]
    fn an_unknown_sample_is_none() {
        assert_eq!(open_sample("nope"), None);
    }

    #[test]
    fn only_the_gallery_pictures_are_hidden() {
        for summary in samples().into_iter().filter(|s| s.group.is_empty()) {
            let project = open_sample(&summary.id).unwrap();
            for file in &project.files {
                let should_hide = summary.id == "gallery" && file.name.ends_with(".jpg");
                assert_eq!(file.hidden, should_hide, "{}/{}", summary.id, file.name);
                assert_eq!(file.picture, should_hide, "{}/{}", summary.id, file.name);
            }
        }
    }

    #[test]
    fn every_file_ends_with_exactly_one_newline() {
        let mut all: Vec<ContentFile> = samples()
            .iter()
            .flat_map(|s| open_sample(&s.id).unwrap().files)
            .collect();
        all.extend(new_project("inline").unwrap().files);
        all.extend(new_project("file").unwrap().files);
        for file in all.iter().filter(|file| !file.picture) {
            assert!(file.code.ends_with('\n'), "{}", file.name);
            assert!(!file.code.ends_with("\n\n"), "{}", file.name);
            assert!(!file.code.contains('\r'), "{}", file.name);
        }
    }

    #[test]
    fn every_sample_has_a_page_and_its_links_work() {
        for summary in samples() {
            let project = open_sample(&summary.id).unwrap();
            assert!(project
                .files
                .iter()
                .any(|f| kind_for_name(&f.name).is_some_and(|kind| kind.is_page)));
            let files: Vec<(&str, &str)> = project
                .files
                .iter()
                .map(|f| (f.name.as_str(), f.code.as_str()))
                .collect();
            let broken = broken_references(files.iter().copied());
            assert_eq!(broken, Vec::<String>::new(), "{}", summary.id);
        }
    }

    #[test]
    fn sample_texts_hold_the_lines_of_the_plan() {
        let line = |id: &str, name: &str, wanted: &str| {
            let project = open_sample(id).unwrap();
            assert!(
                file(&project, name).code.contains(wanted),
                "{id}/{name}: {wanted}"
            );
        };
        line(
            "space-poster",
            "my-page.html",
            "  <body style=\"background: #0b1d3a; color: white;\">\n",
        );
        line(
            "space-poster",
            "my-page.html",
            "      A day on Venus is longer than its year!\n",
        );
        line(
            "space-club",
            "my-page.html",
            "      <li>Saturn has rings</li>\n",
        );
        line(
            "space-club",
            "planets.html",
            "    <p><a href=\"my-page.html\">Back to my page</a></p>\n",
        );
        line(
            "space-club",
            "planets.html",
            "      Saturn is so light it could float in water!\n",
        );
        line(
            "space-club",
            "style.css",
            "  font-family: Verdana, sans-serif;\n",
        );
        line(
            "my-hobby",
            "my-page.html",
            "    <h1>My hobby is football</h1>\n",
        );
        line(
            "my-hobby",
            "my-page.html",
            "        background-color: #fff7e6;\n",
        );
        line("pancakes", "recipe.html", "      <li>5 dl milk</li>\n");
        line(
            "pancakes",
            "recipe.html",
            "      <li>Pour in a little batter and cook both sides.</li>\n",
        );
        line(
            "pancakes",
            "style.css",
            ".note {\n  background-color: #fef3c7;\n",
        );
        line(
            "gallery",
            "gallery.html",
            "        <img src=\"tree.jpg\" alt=\"A big tree in a field\" width=\"160\" height=\"120\">\n",
        );
        line("gallery", "style.css", "  flex-wrap: wrap;\n");
    }

    #[test]
    fn a_whole_sample_file_is_exact() {
        let project = open_sample("space-poster").unwrap();
        assert_eq!(
            file(&project, "my-page.html").code,
            "<!doctype html>\n<html lang=\"en\">\n  <head>\n    <meta charset=\"utf-8\">\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n    <title>Space poster</title>\n  </head>\n  <body style=\"background: #0b1d3a; color: white;\">\n    <h1 style=\"color: gold;\">Welcome to space!</h1>\n    <p>Space is very big and very dark.</p>\n\n    <p style=\"background: #1e3a6e; padding: 12px;\">\n      A day on Venus is longer than its year!\n    </p>\n  </body>\n</html>\n"
        );
    }

    #[test]
    fn content_files_hold_no_em_or_en_dash() {
        let path = gallery_dir().expect("a gallery folder").join("templates.json");
        let gallery = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("{}: {e}", path.display()));
        for (name, text) in [
            ("starters", STARTERS_JSON),
            ("samples", SAMPLES_JSON),
            ("gallery templates.json", gallery.as_str()),
        ] {
            let mut problems = Vec::new();
            check_dashes(&serde_json::from_str(text).unwrap(), &mut problems);
            assert_eq!(problems, Vec::<String>::new(), "{name}");
        }
    }

    #[test]
    fn results_serialize_camel_case() {
        let value = serde_json::to_value(samples()).unwrap();
        assert_eq!(value[0]["title"], "Space poster");
        let value = serde_json::to_value(open_sample("gallery").unwrap()).unwrap();
        assert_eq!(value["name"], "My gallery");
        assert_eq!(value["files"][2]["hidden"], true);
        let value = serde_json::to_value(new_file("css", "a", None).unwrap()).unwrap();
        assert_eq!(value["file"], "a.css");
    }
}
