//! ISO-8601 instant parsing, mirroring `packages/core/src/quote-freshness.ts`:
//! the same shape regex semantics (`YYYY-MM-DDTHH:MM:SS(.mmm)?(Z|+HH:MM|-HH:MM)`)
//! and the same epoch-milliseconds result `Date.parse` produces for that shape.
//! No clock is read anywhere in this module — it only converts strings the
//! orchestrator supplies.

/// Parse a strictly ISO-8601-shaped instant into epoch milliseconds.
/// Returns `None` for anything outside the shape the TypeScript freshness
/// evaluator accepts (refused, never guessed).
pub fn parse_iso_instant_ms(value: &str) -> Option<i64> {
    let bytes = value.as_bytes();
    if bytes.len() < 20 {
        return None;
    }
    let digits = |range: std::ops::Range<usize>| -> Option<i64> {
        let slice = bytes.get(range)?;
        if !slice.iter().all(u8::is_ascii_digit) {
            return None;
        }
        std::str::from_utf8(slice).ok()?.parse::<i64>().ok()
    };
    let expect =
        |index: usize, ch: u8| -> Option<()> { (bytes.get(index) == Some(&ch)).then_some(()) };

    let year = digits(0..4)?;
    expect(4, b'-')?;
    let month = digits(5..7)?;
    expect(7, b'-')?;
    let day = digits(8..10)?;
    expect(10, b'T')?;
    let hour = digits(11..13)?;
    expect(13, b':')?;
    let minute = digits(14..16)?;
    expect(16, b':')?;
    let second = digits(17..19)?;

    let mut index = 19;
    let mut millis = 0i64;
    if bytes.get(index) == Some(&b'.') {
        let start = index + 1;
        let mut end = start;
        while end < bytes.len() && bytes[end].is_ascii_digit() {
            end += 1;
        }
        let count = end - start;
        if count == 0 || count > 3 {
            return None;
        }
        let frac = digits(start..end)?;
        millis = match count {
            1 => frac * 100,
            2 => frac * 10,
            _ => frac,
        };
        index = end;
    }

    let offset_minutes: i64 = match bytes.get(index) {
        Some(b'Z') => {
            if index + 1 != bytes.len() {
                return None;
            }
            0
        }
        Some(sign @ (b'+' | b'-')) => {
            if index + 6 != bytes.len() {
                return None;
            }
            let oh = digits(index + 1..index + 3)?;
            expect(index + 3, b':')?;
            let om = digits(index + 4..index + 6)?;
            if oh > 23 || om > 59 {
                return None;
            }
            let total = oh * 60 + om;
            if *sign == b'-' {
                -total
            } else {
                total
            }
        }
        _ => return None,
    };

    // Range checks mirror Date.parse's refusals for this shape.
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    if hour > 23 || minute > 59 || second > 59 {
        return None;
    }
    if day > days_in_month(year, month) {
        return None;
    }

    let days = days_from_civil(year, month, day);
    let seconds = days * 86_400 + hour * 3_600 + minute * 60 + second;
    Some((seconds - offset_minutes * 60) * 1_000 + millis)
}

fn is_leap_year(year: i64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

fn days_in_month(year: i64, month: i64) -> i64 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if is_leap_year(year) {
                29
            } else {
                28
            }
        }
        _ => 0,
    }
}

/// Days from 1970-01-01 (Howard Hinnant's `days_from_civil` algorithm).
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_known_instants_to_the_same_epoch_ms_as_date_parse() {
        // Values cross-checked against JavaScript Date.parse.
        assert_eq!(parse_iso_instant_ms("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_iso_instant_ms("1970-01-01T00:00:00.123Z"), Some(123));
        assert_eq!(
            parse_iso_instant_ms("2026-06-12T12:00:00.000Z"),
            Some(1_781_265_600_000)
        );
        assert_eq!(
            parse_iso_instant_ms("2026-06-12T13:59:30+02:00"),
            Some(1_781_265_570_000)
        );
        assert_eq!(
            parse_iso_instant_ms("2000-02-29T23:59:59.9Z"),
            Some(951_868_799_900)
        );
        assert_eq!(parse_iso_instant_ms("1969-12-31T23:59:59Z"), Some(-1_000));
    }

    #[test]
    fn refuses_non_iso_shapes_like_the_typescript_evaluator() {
        for bad in [
            "",
            "yesterday",
            "2026-06-12",
            "2026-06-12T12:00Z",
            "2026-06-12 12:00:00Z",
            "2026-06-12T12:00:00",
            "2026-06-12T12:00:00.1234Z",
            "2026-13-01T00:00:00Z",
            "2026-02-30T00:00:00Z",
            "2026-06-12T24:00:00Z",
            "2026-06-12T12:00:00+2:00",
            "2026-06-12T12:00:00Zx",
        ] {
            assert_eq!(parse_iso_instant_ms(bad), None, "{bad:?} must refuse");
        }
    }

    #[test]
    fn leap_year_arithmetic_is_sound() {
        assert!(is_leap_year(2000));
        assert!(!is_leap_year(1900));
        assert!(is_leap_year(2024));
        assert_eq!(days_in_month(2024, 2), 29);
        assert_eq!(days_in_month(2025, 2), 28);
    }
}
