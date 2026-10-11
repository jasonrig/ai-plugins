#[path = "extract.rs"]
mod extract;

use std::{env, fs, path::PathBuf};

fn main() {
    println!("cargo:rerun-if-env-changed=CODEX_SCHEMA_SOURCE_DIR");
    println!("cargo:rerun-if-changed=extract.rs");
    let directory = PathBuf::from(
        env::var("CODEX_SCHEMA_SOURCE_DIR")
            .expect("set CODEX_SCHEMA_SOURCE_DIR via npm run schema:extract"),
    );
    let mut sources = Vec::new();
    for name in [
        "marketplace.rs",
        "manifest.rs",
        "protocol.rs",
        "hook_config.rs",
    ] {
        let path = directory.join(name);
        println!("cargo:rerun-if-changed={}", path.display());
        sources.push(fs::read_to_string(path).expect("read verified Codex source"));
    }
    let generated = extract::generate(&sources)
        .expect("extract Codex input types; upstream changes need review");
    let output = PathBuf::from(env::var_os("OUT_DIR").expect("Cargo OUT_DIR"));
    fs::write(output.join("codex_types.rs"), generated).expect("write extracted types");
}
