//! Pure base58 encode/decode (Bitcoin alphabet) — no dependencies. `decode`
//! validates mint addresses (S98); `encode` turns 32-byte account/program keys
//! back into the base58 strings the TypeScript `@solana/web3.js` decoder emits,
//! so the S100 transaction inspector can be checked for parity field by field.

const ALPHABET: &[u8; 58] = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

fn digit_value(b: u8) -> Option<u32> {
    ALPHABET.iter().position(|c| *c == b).map(|i| i as u32)
}

/// Decode a base58 string to bytes; `None` on any non-alphabet character.
pub fn decode(input: &str) -> Option<Vec<u8>> {
    let mut bytes: Vec<u8> = Vec::new();
    for &c in input.as_bytes() {
        let mut carry = digit_value(c)?;
        for byte in bytes.iter_mut() {
            let value = (*byte as u32) * 58 + carry;
            *byte = (value & 0xff) as u8;
            carry = value >> 8;
        }
        while carry > 0 {
            bytes.push((carry & 0xff) as u8);
            carry >>= 8;
        }
    }
    let leading_zeros = input.bytes().take_while(|b| *b == b'1').count();
    bytes.extend(std::iter::repeat_n(0u8, leading_zeros));
    bytes.reverse();
    Some(bytes)
}

/// Encode bytes as base58. Mirrors the canonical algorithm (leading zero bytes
/// become leading `'1'` characters).
pub fn encode(bytes: &[u8]) -> String {
    let leading_zeros = bytes.iter().take_while(|b| **b == 0).count();
    let mut digits: Vec<u8> = Vec::new();
    for &byte in bytes {
        let mut carry = byte as u32;
        for digit in digits.iter_mut() {
            let value = (*digit as u32) * 256 + carry;
            *digit = (value % 58) as u8;
            carry = value / 58;
        }
        while carry > 0 {
            digits.push((carry % 58) as u8);
            carry /= 58;
        }
    }
    let mut out = String::with_capacity(leading_zeros + digits.len());
    for _ in 0..leading_zeros {
        out.push('1');
    }
    for &digit in digits.iter().rev() {
        out.push(ALPHABET[digit as usize] as char);
    }
    if out.is_empty() {
        out.push('1');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const WSOL: &str = "So11111111111111111111111111111111111111112";
    const SYSTEM_PROGRAM: &str = "11111111111111111111111111111111";

    #[test]
    fn round_trips_known_public_keys() {
        for key in [
            WSOL,
            SYSTEM_PROGRAM,
            "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        ] {
            let decoded = decode(key).expect("decodes");
            assert_eq!(encode(&decoded), key);
        }
    }

    #[test]
    fn encodes_leading_zero_bytes_as_ones() {
        // 32 zero bytes is the System Program id (all '1').
        assert_eq!(encode(&[0u8; 32]), SYSTEM_PROGRAM);
        assert_eq!(encode(&[0u8, 0, 1]), "112");
    }

    #[test]
    fn decode_rejects_non_alphabet() {
        assert!(decode("0OIl").is_none());
    }
}
