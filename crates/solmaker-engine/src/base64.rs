//! Pure standard-alphabet base64 decode — no dependencies. Used to turn an
//! envelope's `txBase64` into the raw transaction bytes the S100 inspector
//! parses. Strict: any non-alphabet byte (outside trailing `=` padding) is a
//! decode failure, never silently skipped.

fn sextet(b: u8) -> Option<u32> {
    Some(match b {
        b'A'..=b'Z' => (b - b'A') as u32,
        b'a'..=b'z' => (b - b'a' + 26) as u32,
        b'0'..=b'9' => (b - b'0' + 52) as u32,
        b'+' => 62,
        b'/' => 63,
        _ => return None,
    })
}

/// Decode a standard-alphabet base64 string to bytes; `None` on any invalid
/// character. Trailing `=` padding is accepted and ignored.
pub fn decode(input: &str) -> Option<Vec<u8>> {
    let bytes = input.as_bytes();
    let mut end = bytes.len();
    while end > 0 && bytes[end - 1] == b'=' {
        end -= 1;
    }
    let mut out: Vec<u8> = Vec::with_capacity(end * 3 / 4 + 1);
    let mut buffer: u32 = 0;
    let mut bits: u32 = 0;
    for &b in &bytes[..end] {
        buffer = (buffer << 6) | sextet(b)?;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buffer >> bits) as u8);
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_known_vectors() {
        assert_eq!(decode("").unwrap(), b"");
        assert_eq!(decode("Zg==").unwrap(), b"f");
        assert_eq!(decode("Zm8=").unwrap(), b"fo");
        assert_eq!(decode("Zm9v").unwrap(), b"foo");
        assert_eq!(decode("Zm9vYmFy").unwrap(), b"foobar");
    }

    #[test]
    fn decodes_without_padding_too() {
        assert_eq!(decode("Zg").unwrap(), b"f");
        assert_eq!(decode("Zm8").unwrap(), b"fo");
    }

    #[test]
    fn rejects_non_alphabet_bytes() {
        assert!(decode("Zg@=").is_none());
        assert!(decode("not base64!").is_none());
    }
}
