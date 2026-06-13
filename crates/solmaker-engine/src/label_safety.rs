//! Secret-shape detection for provider labels, mirroring the value patterns of
//! `packages/security/src/redact.ts` (`redactString`). Where TypeScript would
//! REDACT a span, this normalizer DROPS the whole label (returns unsafe) — a
//! label is decoration, never worth carrying anything secret-shaped.
//!
//! TypeScript stays the authority: the engine-bridge validator re-applies the
//! real `redactString` to every label this engine emits and REFUSES the whole
//! artifact if anything secret-shaped survived. This module only has to be at
//! least as strict on the inputs that matter; on pathological boundary cases
//! it may drop a label TypeScript would keep, never the reverse direction
//! unchecked.

/// JS regex word characters (`\w`): ASCII alphanumerics and underscore.
fn is_word_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

/// ASCII whitespace as JS `\s` sees it (the Unicode additions cannot appear
/// inside the byte-scans below without breaking the ASCII token classes).
fn is_space_byte(b: u8) -> bool {
    matches!(b, b' ' | b'\t' | b'\n' | b'\r' | b'\x0c' | b'\x0b')
}

fn is_base58_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() && !matches!(b, b'0' | b'O' | b'I' | b'l')
}

fn is_hex_byte(b: u8) -> bool {
    b.is_ascii_hexdigit()
}

/// `Bearer <token>` (case-insensitive, word boundary before, >=1 space, >=1
/// token char) — mirrors `/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi`.
fn has_bearer_span(bytes: &[u8]) -> bool {
    let needle = b"bearer";
    let mut i = 0;
    while i + needle.len() < bytes.len() + 1 {
        let window = &bytes[i..i + needle.len()];
        let matches_word = window.eq_ignore_ascii_case(needle);
        let boundary_ok = i == 0 || !is_word_byte(bytes[i - 1]);
        if matches_word && boundary_ok {
            let mut j = i + needle.len();
            let mut spaces = 0;
            while j < bytes.len() && is_space_byte(bytes[j]) {
                spaces += 1;
                j += 1;
            }
            let token_char = j < bytes.len()
                && (bytes[j].is_ascii_alphanumeric()
                    || matches!(bytes[j], b'.' | b'_' | b'~' | b'+' | b'/' | b'=' | b'-'));
            if spaces > 0 && token_char {
                return true;
            }
        }
        i += 1;
    }
    false
}

/// `?key=...` / `&token=...` style query parameters — mirrors
/// `/([?&](?:api[-_]?key|apikey|access[-_]?token|token|key|secret)=)[^&\s#"']+/gi`.
fn has_query_param_secret(bytes: &[u8]) -> bool {
    const NAMES: [&str; 9] = [
        "api-key",
        "api_key",
        "apikey",
        "access-token",
        "access_token",
        "accesstoken",
        "token",
        "key",
        "secret",
    ];
    for (i, b) in bytes.iter().enumerate() {
        if *b != b'?' && *b != b'&' {
            continue;
        }
        for name in NAMES {
            let start = i + 1;
            let end = start + name.len();
            if end < bytes.len()
                && bytes[start..end].eq_ignore_ascii_case(name.as_bytes())
                && bytes[end] == b'='
            {
                let after = bytes.get(end + 1);
                let value_ok = after.is_some_and(|c| {
                    *c != b'&' && *c != b'#' && *c != b'"' && *c != b'\'' && !is_space_byte(*c)
                });
                if value_ok {
                    return true;
                }
            }
        }
    }
    false
}

/// A maximal run of `pred` bytes that is >= `min` long with JS `\b` word
/// boundaries on both sides. `hex_prefix` additionally accepts an `0x`/`0X`
/// immediately before the run (the boundary then applies before the `0`).
fn has_bounded_run(bytes: &[u8], pred: fn(u8) -> bool, min: usize, hex_prefix: bool) -> bool {
    let mut i = 0;
    while i < bytes.len() {
        if !pred(bytes[i]) {
            i += 1;
            continue;
        }
        let start = i;
        while i < bytes.len() && pred(bytes[i]) {
            i += 1;
        }
        if i - start < min {
            continue;
        }
        let after_ok = i == bytes.len() || !is_word_byte(bytes[i]);
        let mut boundary_index = start;
        if hex_prefix
            && start >= 2
            && (bytes[start - 1] == b'x' || bytes[start - 1] == b'X')
            && bytes[start - 2] == b'0'
        {
            boundary_index = start - 2;
        }
        let before_ok = boundary_index == 0 || !is_word_byte(bytes[boundary_index - 1]);
        if before_ok && after_ok {
            return true;
        }
    }
    false
}

/// Twelve or more consecutive lowercase words of 3–8 letters separated by one
/// whitespace char each — mirrors `/\b(?:[a-z]{3,8}\s){11,23}[a-z]{3,8}\b/g`
/// (the recovery-phrase shape).
fn has_lowercase_word_chain(bytes: &[u8]) -> bool {
    let mut i = 0;
    while i < bytes.len() {
        let boundary_ok = i == 0 || !is_word_byte(bytes[i - 1]);
        if !boundary_ok || !bytes[i].is_ascii_lowercase() {
            i += 1;
            continue;
        }
        let mut words = 0;
        let mut j = i;
        loop {
            let word_start = j;
            while j < bytes.len() && bytes[j].is_ascii_lowercase() {
                j += 1;
            }
            let len = j - word_start;
            let end_boundary = j == bytes.len() || !is_word_byte(bytes[j]);
            if !(3..=8).contains(&len) || !end_boundary {
                break;
            }
            words += 1;
            if j < bytes.len()
                && is_space_byte(bytes[j])
                && j + 1 < bytes.len()
                && bytes[j + 1].is_ascii_lowercase()
            {
                j += 1;
                continue;
            }
            break;
        }
        if words >= 12 {
            return true;
        }
        i += 1;
    }
    false
}

/// True when a label carries no secret-shaped span (safe to keep verbatim).
pub fn label_is_redaction_safe(label: &str) -> bool {
    let bytes = label.as_bytes();
    !(has_bearer_span(bytes)
        || has_query_param_secret(bytes)
        || has_bounded_run(bytes, is_base58_byte, 80, false)
        || has_bounded_run(bytes, is_hex_byte, 64, true)
        || has_lowercase_word_chain(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ordinary_labels_are_safe() {
        for label in [
            "pump.fun",
            "BONK",
            "My Token (beta)",
            "rocket 🚀 coin",
            "good word list short",
            "deadbeef", // short hex is fine
        ] {
            assert!(label_is_redaction_safe(label), "{label:?} should be safe");
        }
    }

    #[test]
    fn bearer_tokens_are_unsafe() {
        assert!(!label_is_redaction_safe("Bearer abc123"));
        assert!(!label_is_redaction_safe("x bearer  t0k.en"));
        assert!(label_is_redaction_safe("forebearer of doom")); // no boundary before "bearer"
        assert!(label_is_redaction_safe("Bearer")); // no token follows
    }

    #[test]
    fn query_param_secrets_are_unsafe() {
        assert!(!label_is_redaction_safe("see ?api-key=abc"));
        assert!(!label_is_redaction_safe("u?TOKEN=zzz"));
        assert!(!label_is_redaction_safe("a&secret=1"));
        assert!(label_is_redaction_safe("?key=")); // empty value never matched in TS either
        assert!(label_is_redaction_safe("monkey=banana")); // name must follow ? or & directly
    }

    #[test]
    fn long_hex_runs_are_unsafe() {
        let hex64 = "a1".repeat(32);
        assert!(!label_is_redaction_safe(&hex64));
        assert!(!label_is_redaction_safe(&format!("0x{hex64}")));
        assert!(label_is_redaction_safe(&"a1".repeat(31))); // 62 chars: below floor
        assert!(label_is_redaction_safe(&format!("{hex64}g"))); // word char after run: no JS \b
    }

    #[test]
    fn long_base58_runs_are_unsafe() {
        // 'z' is base58 but not hex, isolating this detector from the hex one.
        let blob = "z".repeat(80);
        assert!(!label_is_redaction_safe(&blob));
        assert!(label_is_redaction_safe(&"z".repeat(79)));
    }

    #[test]
    fn lowercase_word_chains_are_unsafe() {
        let chain = ["abandon"; 12].join(" ");
        assert!(!label_is_redaction_safe(&chain));
        assert!(label_is_redaction_safe(&["abandon"; 11].join(" ")));
        assert!(label_is_redaction_safe(
            "the chain breaks on a Capitalized word here ok fine yes"
        ));
    }
}
