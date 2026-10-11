#![allow(dead_code)]
use schemars::generate::SchemaSettings;
use serde::Deserialize;
use std::{error::Error, fs, path::PathBuf};

include!(concat!(env!("OUT_DIR"), "/codex_types.rs"));

#[cfg(test)]
#[path = "../extract.rs"]
mod extract;

fn main() -> Result<(), Box<dyn Error>> {
    let directory = PathBuf::from(
        std::env::args()
            .nth(1)
            .ok_or("provide an output directory")?,
    );
    fs::create_dir_all(&directory)?;
    macro_rules! export {
        ($name:literal, $type:ty) => {
            let schema = SchemaSettings::draft2020_12()
                .for_deserialize()
                .into_generator()
                .into_root_schema_for::<$type>();
            fs::write(
                directory.join($name),
                format!("{}\n", serde_json::to_string_pretty(&schema)?),
            )?;
        };
    }
    export!("codex-marketplace.schema.json", RawMarketplaceManifest);
    export!("codex-plugin.schema.json", RawPluginManifest);
    export!("codex-hooks.schema.json", HooksFile);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::HooksFile;
    use serde_json::json;

    #[test]
    fn preserves_upstream_mcp_hook_input_validation() {
        let mut hooks = json!({
            "hooks": {
                "SessionStart": [{
                    "hooks": [{
                        "type": "mcp_tool",
                        "server": "example",
                        "tool": "read",
                        "input": { "value": "valid" }
                    }]
                }]
            }
        });
        assert!(serde_json::from_value::<HooksFile>(hooks.clone()).is_ok());
        hooks["hooks"]["SessionStart"][0]["hooks"][0]["input"]["value"] = json!(null);
        assert!(serde_json::from_value::<HooksFile>(hooks).is_err());
    }
}
