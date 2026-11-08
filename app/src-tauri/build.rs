use std::fmt::Write;
use std::path::Path;

fn write_fonts() {
    let dir = Path::new(&std::env::var("CARGO_MANIFEST_DIR").unwrap()).join("../core/content/fonts");
    let list = dir.join("fonts.json");
    println!("cargo:rerun-if-changed={}", list.display());
    let mut table = String::new();
    let mut style = String::new();
    if std::env::var("CARGO_CFG_TARGET_OS").unwrap() != "macos" {
        let base = if std::env::var("CARGO_CFG_TARGET_OS").unwrap() == "windows" {
            "http://preview.localhost"
        } else {
            "preview://localhost"
        };
        let faces: Vec<serde_json::Value> =
            serde_json::from_str(&std::fs::read_to_string(&list).unwrap()).unwrap();
        let mut files: Vec<&str> = faces.iter().map(|f| f["file"].as_str().unwrap()).collect();
        files.sort();
        files.dedup();
        for file in files {
            let path = dir.join(file).canonicalize().unwrap();
            writeln!(table, "({file:?}, include_bytes!({:?})),", path.to_str().unwrap()).unwrap();
        }
        style.push_str("<style>");
        for face in &faces {
            let mac = face["mac"].as_str().unwrap();
            write!(
                style,
                "@font-face{{font-family:\"{mac}\";font-weight:{};font-style:{};src:local(\"{mac}\"),url({base}/__fonts/{}) format(\"woff2\")}}",
                face["weight"].as_str().unwrap(),
                face["style"].as_str().unwrap(),
                face["file"].as_str().unwrap(),
            )
            .unwrap();
        }
        style.push_str("</style>");
    }
    let code = format!(
        "const FONTS: &[(&str, &[u8])] = &[{table}];\nconst FONT_STYLE: &str = {style:?};\n"
    );
    let out = Path::new(&std::env::var("OUT_DIR").unwrap()).join("fonts.rs");
    std::fs::write(out, code).unwrap();
}

fn main() {
    write_fonts();
    tauri_build::build()
}
