//! Mint-address validation mirroring `packages/sniper/src/mint-address.ts`
//! (`parseMintAddress`): trim, 32–44 base58 chars, full decode to exactly 32
//! bytes. Anything longer is refused UP FRONT — a 64-byte secret key encodes
//! to ~88 base58 chars and must never travel further than this check. Error
//! messages never echo the rejected value.

const MIN_MINT_BASE58_LEN: usize = 32;
const MAX_MINT_BASE58_LEN: usize = 44;
const MINT_BYTE_LENGTH: usize = 32;

const BASE58_ALPHABET: &[u8; 58] = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

fn base58_digit(b: u8) -> Option<u32> {
    BASE58_ALPHABET
        .iter()
        .position(|c| *c == b)
        .map(|i| i as u32)
}

/// Decode a base58 string to bytes; `None` on any non-alphabet character.
fn base58_decode(input: &str) -> Option<Vec<u8>> {
    let mut bytes: Vec<u8> = Vec::new();
    for &c in input.as_bytes() {
        let digit = base58_digit(c)?;
        let mut carry = digit;
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

/// Why a mint value was refused. Messages deliberately carry the LENGTH, never
/// the value itself.
#[derive(Debug, PartialEq, Eq)]
pub enum MintError {
    NotAString,
    Empty,
    TooLong(usize),
    TooShort(usize),
    NotBase58,
    NotPublicKeySized(usize),
}

impl std::fmt::Display for MintError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MintError::NotAString => write!(f, "mint address must be a string"),
            MintError::Empty => write!(f, "mint address is empty"),
            MintError::TooLong(n) => write!(
                f,
                "mint address is {n} chars - too long to be a public key (never paste key material)"
            ),
            MintError::TooShort(n) => {
                write!(
                    f,
                    "mint address is {n} chars - too short to be a public key"
                )
            }
            MintError::NotBase58 => write!(f, "mint address is not valid base58"),
            MintError::NotPublicKeySized(n) => {
                write!(
                    f,
                    "mint address does not decode to a 32-byte public key (got {n} bytes)"
                )
            }
        }
    }
}

/// Validate a candidate mint string. Returns the trimmed mint on success.
pub fn parse_mint(input: &str) -> Result<String, MintError> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(MintError::Empty);
    }
    let len = trimmed.chars().count();
    if len > MAX_MINT_BASE58_LEN {
        return Err(MintError::TooLong(len));
    }
    if len < MIN_MINT_BASE58_LEN {
        return Err(MintError::TooShort(len));
    }
    let decoded = base58_decode(trimmed).ok_or(MintError::NotBase58)?;
    if decoded.len() != MINT_BYTE_LENGTH {
        return Err(MintError::NotPublicKeySized(decoded.len()));
    }
    Ok(trimmed.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Well-known PUBLIC mint addresses (public chain data, never secrets).
    const WSOL: &str = "So11111111111111111111111111111111111111112";
    const USDC: &str = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

    #[test]
    fn accepts_known_public_mints_and_trims() {
        assert_eq!(parse_mint(WSOL).unwrap(), WSOL);
        assert_eq!(parse_mint(&format!("  {USDC}  ")).unwrap(), USDC);
    }

    #[test]
    fn refuses_secret_length_input_up_front() {
        let secret_shaped = "5".repeat(88);
        assert_eq!(
            parse_mint(&secret_shaped).unwrap_err(),
            MintError::TooLong(88)
        );
    }

    #[test]
    fn refuses_empty_short_and_non_base58() {
        assert_eq!(parse_mint("   ").unwrap_err(), MintError::Empty);
        assert_eq!(parse_mint("abc").unwrap_err(), MintError::TooShort(3));
        // 'I' and '0' are not in the base58 alphabet.
        let bad = "I0".repeat(20);
        assert_eq!(parse_mint(&bad).unwrap_err(), MintError::NotBase58);
    }

    #[test]
    fn refuses_a_valid_base58_string_that_is_not_32_bytes() {
        // 43 chars of '1' decode to 43 leading zero bytes — not a 32-byte key.
        let ones = "1".repeat(43);
        assert_eq!(
            parse_mint(&ones).unwrap_err(),
            MintError::NotPublicKeySized(43)
        );
    }

    #[test]
    fn error_text_never_echoes_the_value() {
        let secret_shaped = "9".repeat(88);
        let msg = parse_mint(&secret_shaped).unwrap_err().to_string();
        assert!(!msg.contains('9'));
        assert!(msg.contains("88 chars"));
    }
}
