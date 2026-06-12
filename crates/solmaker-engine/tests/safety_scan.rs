//! Capability scan over the engine's PRODUCTION source (`src/` only — never
//! `build.rs`, never this test). The Rust sidecar must not become an
//! unreviewed escape hatch around the TypeScript safety walls, so any
//! signer-, key-, send-, subprocess-, or network-shaped token appearing in
//! `src/` fails this test. A mirrored scan lives on the TypeScript side
//! (packages/engine-bridge) so the wall holds even where cargo is absent.

use std::fs;
use std::path::{Path, PathBuf};

/// Forbidden tokens, matched case-insensitively against comment-stripped
/// source. Composed at runtime (first + rest) so the list can never match
/// itself if this file is ever scanned by mistake.
fn forbidden_tokens() -> Vec<String> {
    let raw: &[(&str, &str)] = &[
        ("key", "pair"),
        ("secret", "_key"),
        ("secret", "key"),
        ("private", "_key"),
        ("private", "key"),
        ("mne", "monic"),
        ("seed", "_phrase"),
        ("seed", "phrase"),
        ("sign_", "transaction"),
        ("sign", "transaction"),
        ("send_", "transaction"),
        ("send", "transaction"),
        ("send_raw", "_transaction"),
        ("sendandc", "onfirm"),
        ("request_", "airdrop"),
        ("requesta", "irdrop"),
        ("req", "west"),
        ("hyp", "er::"),
        ("tok", "io"),
        ("async", "_std"),
        ("websoc", "ket"),
        ("tungst", "enite"),
        ("std::", "net"),
        ("tcpst", "ream"),
        ("udpso", "cket"),
        ("command::", "new"),
        ("process::", "command"),
        (".spaw", "n("),
        ("solana_", "sdk"),
        ("solana_", "client"),
        ("wallet_", "file"),
        ("load_", "wallet"),
        ("read_key", "pair"),
        ("ed25", "519"),
        ("curve25", "519"),
    ];
    raw.iter().map(|(a, b)| format!("{a}{b}")).collect()
}

fn src_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("src")
}

fn rust_source_files(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for entry in fs::read_dir(dir).expect("src/ readable") {
        let path = entry.expect("dir entry").path();
        if path.is_dir() {
            out.extend(rust_source_files(&path));
        } else if path.extension().is_some_and(|ext| ext == "rs") {
            out.push(path);
        }
    }
    out.sort();
    out
}

/// Remove `//` line comments and `/* */` block comments so documentation that
/// NAMES a forbidden concept ("no keypair loading") never trips the code scan.
/// Deliberately naive: no string literal in this crate contains `//` or `/*`,
/// and the companion test below keeps it that way.
fn strip_comments(source: &str) -> String {
    let mut without_blocks = String::with_capacity(source.len());
    let mut rest = source;
    while let Some(start) = rest.find("/*") {
        without_blocks.push_str(&rest[..start]);
        match rest[start + 2..].find("*/") {
            Some(end) => rest = &rest[start + 2 + end + 2..],
            None => {
                rest = "";
                break;
            }
        }
    }
    without_blocks.push_str(rest);
    without_blocks
        .lines()
        .map(|line| line.find("//").map_or(line, |idx| &line[..idx]))
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn production_source_has_no_forbidden_capability_token() {
    let files = rust_source_files(&src_dir());
    assert!(
        files.len() >= 5,
        "expected the full module set, found {}",
        files.len()
    );
    let tokens = forbidden_tokens();
    let mut violations = Vec::new();
    for file in &files {
        let source = fs::read_to_string(file).expect("source readable");
        let code = strip_comments(&source).to_lowercase();
        for token in &tokens {
            if code.contains(token.as_str()) {
                violations.push(format!(
                    "{} contains forbidden token {token:?}",
                    file.display()
                ));
            }
        }
    }
    assert!(violations.is_empty(), "{}", violations.join("\n"));
}

#[test]
fn comment_stripping_stays_sound() {
    for file in rust_source_files(&src_dir()) {
        let source = fs::read_to_string(&file).expect("source readable");
        assert!(
            !source.contains("/*") && !source.contains("*/"),
            "{}: this crate uses only // comments so the scan stripper stays sound",
            file.display()
        );
        for (idx, line) in source.lines().enumerate() {
            if let Some(i) = line.find("//") {
                let quotes_before = line[..i].matches('"').count();
                assert!(
                    quotes_before % 2 == 0,
                    "{}:{} has // inside a string literal, which would blind the scan",
                    file.display(),
                    idx + 1
                );
            }
        }
    }
}

#[test]
fn dependency_set_is_exactly_the_reviewed_allowlist() {
    let manifest = fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml"))
        .expect("Cargo.toml readable");
    let deps_section = manifest
        .split("[dependencies]")
        .nth(1)
        .expect("dependencies section exists");
    let deps: Vec<&str> = deps_section
        .lines()
        .take_while(|line| !line.trim().starts_with('['))
        .filter(|line| !line.trim().is_empty() && !line.trim().starts_with('#'))
        .filter_map(|line| line.split('=').next())
        .map(str::trim)
        .collect();
    assert_eq!(
        deps,
        vec!["serde", "serde_json"],
        "dependency allowlist drifted — a new dependency needs a reviewed safety decision"
    );
}

#[test]
fn status_artifact_pins_every_disabled_marker() {
    let report = solmaker_engine::build_status_report(None).expect("builds");
    assert_eq!(report.signer_support, "disabled");
    assert_eq!(report.send_support, "disabled");
    assert_eq!(report.mainnet_send_support, "disabled");
    assert!(report.disabled_capabilities.contains(&"signing"));
    assert!(report.disabled_capabilities.contains(&"sending"));
    assert!(report.disabled_capabilities.contains(&"mainnet-live"));
    assert!(report.disabled_capabilities.contains(&"wallet-loading"));
    assert!(report
        .disabled_capabilities
        .contains(&"seed-phrase-handling"));
}
