use quote::{ToTokens, quote};
use std::collections::{BTreeMap, BTreeSet};
use syn::{Attribute, Fields, Item, Type, parse_quote, visit::Visit};

const ROOTS: &[&str] = &["RawMarketplaceManifest", "RawPluginManifest", "HooksFile"];
const PRIMITIVES: &[&str] = &[
    "String",
    "Option",
    "Vec",
    "Box",
    "BTreeMap",
    "JsonMap",
    "JsonValue",
    "bool",
    "u64",
    "usize",
    "std",
    "collections",
];

fn name(item: &Item) -> Option<String> {
    match item {
        Item::Struct(item) => Some(item.ident.to_string()),
        Item::Enum(item) => Some(item.ident.to_string()),
        _ => None,
    }
}

fn default_derive(attrs: &[Attribute]) -> bool {
    attrs.iter().any(|attr| {
        attr.path().is_ident("derive")
            && attr
                .to_token_stream()
                .to_string()
                .split(|c: char| !c.is_alphanumeric())
                .any(|part| part == "Default")
    })
}

fn clean_attrs(attrs: &mut Vec<Attribute>) {
    attrs.retain(|attr| attr.path().is_ident("serde") || attr.path().is_ident("default"));
}

fn clean_fields(fields: &mut Fields) {
    for field in fields.iter_mut() {
        clean_attrs(&mut field.attrs);
    }
}

fn transform(mut item: Item) -> Result<Item, String> {
    match &mut item {
        Item::Struct(item) => {
            let has_default = default_derive(&item.attrs);
            clean_attrs(&mut item.attrs);
            clean_fields(&mut item.fields);
            item.attrs.insert(
                0,
                parse_quote!(#[derive(serde::Serialize, serde::Deserialize, schemars::JsonSchema)]),
            );
            if has_default {
                item.attrs.insert(0, parse_quote!(#[derive(Default)]));
            }
            item.attrs
                .push(parse_quote!(#[schemars(deny_unknown_fields)]));
            if item.ident == "RawMarketplaceManifestPlugin" {
                let field = item
                    .fields
                    .iter_mut()
                    .find(|field| {
                        field
                            .ident
                            .as_ref()
                            .is_some_and(|name| name == "manifest_fields")
                    })
                    .ok_or("missing marketplace fallback metadata field")?;
                if field.ty.to_token_stream().to_string() != "JsonMap < String , JsonValue >" {
                    return Err("marketplace fallback metadata type changed".into());
                }
                // This repository requires package metadata in plugin.json, not catalog fallbacks.
                field.attrs.push(parse_quote!(#[schemars(skip)]));
            }
        }
        Item::Enum(item) => {
            let has_default = default_derive(&item.attrs);
            clean_attrs(&mut item.attrs);
            item.attrs.insert(
                0,
                parse_quote!(#[derive(serde::Serialize, serde::Deserialize, schemars::JsonSchema)]),
            );
            if has_default {
                item.attrs.insert(0, parse_quote!(#[derive(Default)]));
            }
            item.attrs
                .push(parse_quote!(#[schemars(deny_unknown_fields)]));
            let expected_fallback = match item.ident.to_string().as_str() {
                "RawMarketplaceManifestPluginSource" => Some("Unsupported"),
                "RawPluginManifestDefaultPrompt"
                | "RawPluginManifestDefaultPromptEntry"
                | "RawPluginManifestPaths"
                | "RawPluginManifestMcpServers"
                | "RawPluginManifestHooks" => Some("Invalid"),
                _ => None,
            };
            let mut found = false;
            for variant in &mut item.variants {
                clean_attrs(&mut variant.attrs);
                clean_fields(&mut variant.fields);
                if expected_fallback.is_some_and(|name| variant.ident == name) {
                    if variant.fields.len() != 1
                        || variant
                            .fields
                            .iter()
                            .next()
                            .map(|f| f.ty.to_token_stream().to_string())
                            .as_deref()
                            != Some("JsonValue")
                    {
                        return Err(format!("{} fallback type changed", item.ident));
                    }
                    variant.attrs.push(parse_quote!(#[schemars(skip)]));
                    found = true;
                } else if variant
                    .fields
                    .iter()
                    .any(|field| field.ty.to_token_stream().to_string() == "JsonValue")
                {
                    return Err(format!("unexpected untyped fallback in {}", item.ident));
                }
            }
            if expected_fallback.is_some() && !found {
                return Err(format!("{} fallback variant changed", item.ident));
            }
        }
        _ => return Err("expected a struct or enum".into()),
    }
    Ok(item)
}

#[derive(Default)]
struct Dependencies(BTreeSet<String>);
impl<'ast> Visit<'ast> for Dependencies {
    fn visit_type(&mut self, ty: &'ast Type) {
        if let Type::Path(path) = ty {
            for segment in &path.path.segments {
                self.0.insert(segment.ident.to_string());
            }
        }
        syn::visit::visit_type(self, ty);
    }
}

pub fn generate(sources: &[String]) -> Result<String, String> {
    let mut available = BTreeMap::new();
    for source in sources {
        for item in syn::parse_file(source)
            .map_err(|error| error.to_string())?
            .items
        {
            if let Some(name) = name(&item)
                && available.insert(name.clone(), item).is_some()
            {
                return Err(format!("duplicate source type {name}"));
            }
        }
    }
    let mut pending: Vec<String> = ROOTS.iter().map(|name| (*name).into()).collect();
    let mut selected = BTreeMap::new();
    while let Some(name) = pending.pop() {
        if selected.contains_key(&name) || PRIMITIVES.contains(&name.as_str()) {
            continue;
        }
        let item = available
            .get(&name)
            .ok_or_else(|| format!("unresolved source type {name}; add its source file"))?;
        let item = transform(item.clone())?;
        let mut dependencies = Dependencies::default();
        match &item {
            Item::Struct(item) => {
                for field in &item.fields {
                    dependencies.visit_type(&field.ty);
                }
            }
            Item::Enum(item) => {
                for variant in &item.variants {
                    for field in &variant.fields {
                        dependencies.visit_type(&field.ty);
                    }
                }
            }
            _ => unreachable!(),
        }
        pending.extend(dependencies.0);
        selected.insert(name, item);
    }
    let declarations = selected.values();
    Ok(quote! {
        use serde_json::{Map as JsonMap, Value as JsonValue};
        #(#declarations)*
    }
    .to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn excludes_the_unsupported_source_without_changing_serde() {
        let item: Item = parse_quote! {
            #[serde(untagged)] enum RawMarketplaceManifestPluginSource {
                Path(String), Unsupported(JsonValue)
            }
        };
        let output = transform(item).unwrap().to_token_stream().to_string();
        assert!(output.contains("schemars (skip)"));
        assert!(output.contains("Unsupported (JsonValue)"));
        assert!(!output.contains("serde (skip)"));
    }

    #[test]
    fn refuses_to_guess_when_the_fallback_changes() {
        let item: Item = parse_quote! {
            enum RawMarketplaceManifestPluginSource { Path(String), Unknown(JsonValue) }
        };
        assert!(transform(item).is_err());
    }

    #[test]
    fn preserves_serde_field_names() {
        let item: Item = parse_quote! {
            #[serde(rename_all = "camelCase")] struct Metadata {
                #[serde(rename = "ref")] ref_name: Option<String>
            }
        };
        let output = transform(item).unwrap().to_token_stream().to_string();
        assert!(output.contains("rename_all = \"camelCase\""));
        assert!(output.contains("rename = \"ref\""));
    }
}
