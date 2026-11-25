//! Searching documents for byte patterns built from hex, text or numbers.
//!
//! A [`SearchQuery`] from the frontend is turned into a [`Pattern`]: one [`ByteMatcher`] per byte.
//! The search reads the content in chunks that overlap by the pattern length minus one, so
//! matches across chunk boundaries are found, and calls back to read each chunk so the caller can
//! hold the document lock only while a chunk is being read.

use serde::Deserialize;
use std::io;
use std::sync::atomic::{AtomicBool, Ordering};

/// The number of bytes read at a time.
pub const SEARCH_CHUNK_LENGTH: usize = 1024 * 1024;

/// The longest pattern a search accepts.
pub const MAX_PATTERN_LENGTH: usize = 64 * 1024;

/// A text encoding for text searches.
#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TextEncoding {
    Ascii,
    Utf8,
    Utf16Le,
    Utf16Be,
    Utf32Le,
    Utf32Be,
}

/// A number type for number searches.
#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NumberKind {
    U8,
    I8,
    U16,
    I16,
    U32,
    I32,
    U64,
    I64,
    F32,
    F64,
}

/// What to search for, as entered by the user.
#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum SearchQuery {
    /// Hexadecimal bytes such as `48 65 6c`; `??` matches any byte and `4?` any low nibble.
    Hex { text: String },
    /// Text in an encoding; `ignore_case` folds ASCII letters only.
    Text {
        text: String,
        encoding: TextEncoding,
        ignore_case: bool,
    },
    /// A number of the given type and byte order; integers may be written in hex with `0x`.
    Number {
        text: String,
        kind: NumberKind,
        big_endian: bool,
    },
}

/// How one byte of a pattern is matched.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ByteMatcher {
    /// The byte equals the value.
    Exact(u8),
    /// The bits selected by the mask equal the value's.
    Masked { value: u8, mask: u8 },
    /// The byte equals the value when ASCII letters are compared without case.
    AsciiFold(u8),
}

impl ByteMatcher {
    fn matches(self, byte: u8) -> bool {
        match self {
            Self::Exact(value) => byte == value,
            Self::Masked { value, mask } => byte & mask == value & mask,
            Self::AsciiFold(value) => byte.to_ascii_lowercase() == value,
        }
    }
}

/// A byte pattern to search for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pattern {
    matchers: Vec<ByteMatcher>,
}

impl Pattern {
    /// The pattern length in bytes.
    pub fn len(&self) -> usize {
        self.matchers.len()
    }

    /// The bytes of the pattern if every byte must match exactly.
    fn exact_bytes(&self) -> Option<Vec<u8>> {
        self.matchers
            .iter()
            .map(|matcher| match matcher {
                ByteMatcher::Exact(value) => Some(*value),
                _ => None,
            })
            .collect()
    }

    fn matches_at(&self, data: &[u8], position: usize) -> bool {
        self.matchers
            .iter()
            .zip(&data[position..])
            .all(|(matcher, byte)| matcher.matches(*byte))
    }

    /// Finds every match in `data`, calling `found` with each start position in order.
    fn find_all(&self, data: &[u8], mut found: impl FnMut(usize) -> bool) {
        if data.len() < self.len() {
            return;
        }
        if let Some(bytes) = self.exact_bytes() {
            // Search again one byte after each match so overlapping matches are found too
            // (`find_iter` would skip them).
            let finder = memchr::memmem::Finder::new(&bytes);
            let mut position = 0;
            while let Some(found_at) = finder.find(&data[position..]) {
                if !found(position + found_at) {
                    return;
                }
                position += found_at + 1;
            }
            return;
        }
        for position in 0..=data.len() - self.len() {
            if self.matches_at(data, position) && !found(position) {
                return;
            }
        }
    }
}

impl SearchQuery {
    /// Turns the query into a byte pattern.
    pub fn to_pattern(&self) -> Result<Pattern, String> {
        let matchers = match self {
            Self::Hex { text } => parse_hex(text)?,
            Self::Text {
                text,
                encoding,
                ignore_case,
            } => encode_text(text, *encoding, *ignore_case)?,
            Self::Number {
                text,
                kind,
                big_endian,
            } => encode_number(text, *kind, *big_endian)?
                .into_iter()
                .map(ByteMatcher::Exact)
                .collect(),
        };

        if matchers.is_empty() {
            return Err("The search pattern is empty".to_string());
        }
        if matchers.len() > MAX_PATTERN_LENGTH {
            return Err(format!(
                "The search pattern is longer than {MAX_PATTERN_LENGTH} bytes"
            ));
        }
        Ok(Pattern { matchers })
    }
}

/// Parses hex bytes. Whitespace is ignored; `?` is a wildcard nibble.
fn parse_hex(text: &str) -> Result<Vec<ByteMatcher>, String> {
    let digits: Vec<char> = text
        .trim()
        .trim_start_matches("0x")
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect();
    if !digits.len().is_multiple_of(2) {
        return Err("Hex bytes need two digits each".to_string());
    }

    digits
        .chunks(2)
        .map(|pair| {
            let nibble = |c: char| -> Result<Option<u8>, String> {
                if c == '?' {
                    Ok(None)
                } else {
                    c.to_digit(16)
                        .map(|d| Some(d as u8))
                        .ok_or_else(|| format!("'{c}' is not a hex digit"))
                }
            };
            match (nibble(pair[0])?, nibble(pair[1])?) {
                (Some(high), Some(low)) => Ok(ByteMatcher::Exact(high << 4 | low)),
                (high, low) => Ok(ByteMatcher::Masked {
                    value: high.unwrap_or(0) << 4 | low.unwrap_or(0),
                    mask: if high.is_some() { 0xf0 } else { 0 }
                        | if low.is_some() { 0x0f } else { 0 },
                }),
            }
        })
        .collect()
}

/// Encodes text; with `ignore_case`, bytes of ASCII letters match either case.
fn encode_text(
    text: &str,
    encoding: TextEncoding,
    ignore_case: bool,
) -> Result<Vec<ByteMatcher>, String> {
    let mut matchers = Vec::new();
    for c in text.chars() {
        let fold = ignore_case && c.is_ascii_alphabetic();
        let unit = |value: u8| {
            if fold && value.is_ascii_alphabetic() {
                ByteMatcher::AsciiFold(value.to_ascii_lowercase())
            } else {
                ByteMatcher::Exact(value)
            }
        };
        let code = c as u32;
        let bytes: Vec<u8> = match encoding {
            TextEncoding::Ascii => {
                if !c.is_ascii() {
                    return Err(format!("'{c}' is not an ASCII character"));
                }
                vec![c as u8]
            }
            TextEncoding::Utf8 => c.to_string().into_bytes(),
            TextEncoding::Utf16Le | TextEncoding::Utf16Be => {
                let mut units = [0u16; 2];
                c.encode_utf16(&mut units)
                    .iter()
                    .flat_map(|u| {
                        if encoding == TextEncoding::Utf16Le {
                            u.to_le_bytes()
                        } else {
                            u.to_be_bytes()
                        }
                    })
                    .collect()
            }
            TextEncoding::Utf32Le => code.to_le_bytes().to_vec(),
            TextEncoding::Utf32Be => code.to_be_bytes().to_vec(),
        };
        matchers.extend(bytes.into_iter().map(unit));
    }
    Ok(matchers)
}

/// Encodes a number of the given type and byte order.
fn encode_number(text: &str, kind: NumberKind, big_endian: bool) -> Result<Vec<u8>, String> {
    let text = text.trim();
    let invalid = || format!("'{text}' is not a valid {kind:?} value");

    // Integers may be written in hex with a 0x prefix (also after a minus sign).
    let parse_integer = || -> Result<i128, String> {
        let (negative, digits) = match text.strip_prefix('-') {
            Some(rest) => (true, rest),
            None => (false, text),
        };
        let value = match digits
            .strip_prefix("0x")
            .or_else(|| digits.strip_prefix("0X"))
        {
            Some(hex) => i128::from_str_radix(hex, 16),
            None => digits.parse::<i128>(),
        }
        .map_err(|_| invalid())?;
        Ok(if negative { -value } else { value })
    };

    macro_rules! integer {
        ($type:ty) => {{
            let value = <$type>::try_from(parse_integer()?).map_err(|_| {
                format!(
                    "'{text}' is out of range for {kind:?} ({} to {})",
                    <$type>::MIN,
                    <$type>::MAX
                )
            })?;
            if big_endian {
                value.to_be_bytes().to_vec()
            } else {
                value.to_le_bytes().to_vec()
            }
        }};
    }
    macro_rules! float {
        ($type:ty) => {{
            let value: $type = text.parse().map_err(|_| invalid())?;
            if big_endian {
                value.to_be_bytes().to_vec()
            } else {
                value.to_le_bytes().to_vec()
            }
        }};
    }

    Ok(match kind {
        NumberKind::U8 => integer!(u8),
        NumberKind::I8 => integer!(i8),
        NumberKind::U16 => integer!(u16),
        NumberKind::I16 => integer!(i16),
        NumberKind::U32 => integer!(u32),
        NumberKind::I32 => integer!(i32),
        NumberKind::U64 => integer!(u64),
        NumberKind::I64 => integer!(i64),
        NumberKind::F32 => float!(f32),
        NumberKind::F64 => float!(f64),
    })
}

/// Which matches a search looks for.
#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SearchDirection {
    /// The first match starting at or after `from`.
    Next,
    /// The last match starting before `from`.
    Previous,
    /// All matches, in order, up to the limit.
    All,
}

/// The result of a search.
#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    /// The start offsets of the matches.
    pub matches: Vec<u64>,
    /// The length of each match in bytes.
    pub match_length: u64,
    /// Whether more matches exist than were returned.
    pub truncated: bool,
    /// Whether the search was cancelled before it finished.
    pub cancelled: bool,
}

/// Where and how a search looks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SearchOptions {
    /// The offset to search from (ignored for [`SearchDirection::All`]).
    pub from: u64,
    pub direction: SearchDirection,
    /// The largest number of matches [`SearchDirection::All`] returns.
    pub limit: usize,
}

/// Searches content of `len` bytes for `pattern`.
///
/// `read` reads a range of the content (like `Document::read_range`); `progress` is called with
/// the number of bytes scanned so far; `cancel` stops the search early.
pub fn search(
    pattern: &Pattern,
    len: u64,
    options: SearchOptions,
    cancel: &AtomicBool,
    mut read: impl FnMut(u64, usize) -> io::Result<Vec<u8>>,
    mut progress: impl FnMut(u64),
) -> io::Result<SearchResult> {
    let SearchOptions {
        from,
        direction,
        limit,
    } = options;
    let pattern_len = pattern.len() as u64;
    let mut result = SearchResult {
        matches: Vec::new(),
        match_length: pattern_len,
        truncated: false,
        cancelled: false,
    };
    if pattern_len > len {
        return Ok(result);
    }
    // The last offset where a match can start.
    let last_start = len - pattern_len;
    let overlap = pattern_len - 1;
    let step = SEARCH_CHUNK_LENGTH as u64;

    match direction {
        SearchDirection::Next | SearchDirection::All => {
            let limit = if direction == SearchDirection::Next {
                1
            } else {
                limit
            };
            let mut start = if direction == SearchDirection::Next {
                from
            } else {
                0
            };
            while start <= last_start {
                if cancel.load(Ordering::Relaxed) {
                    result.cancelled = true;
                    break;
                }
                let chunk = read(start, (step + overlap) as usize)?;
                let mut done = false;
                pattern.find_all(&chunk, |position| {
                    let offset = start + position as u64;
                    // Matches starting in the overlap are found again in the next chunk.
                    if position as u64 >= step && start + step <= last_start {
                        return false;
                    }
                    if result.matches.len() == limit {
                        result.truncated = true;
                        done = true;
                        return false;
                    }
                    result.matches.push(offset);
                    true
                });
                if done || (direction == SearchDirection::Next && !result.matches.is_empty()) {
                    break;
                }
                start += step;
                progress(start.min(len));
            }
        }
        SearchDirection::Previous => {
            // Matches must start before `from`; scan chunks from the end towards the start.
            let end_start = from.min(last_start + 1);
            let mut chunk_end = end_start;
            while chunk_end > 0 {
                if cancel.load(Ordering::Relaxed) {
                    result.cancelled = true;
                    break;
                }
                let chunk_start = chunk_end.saturating_sub(step);
                let chunk = read(chunk_start, (chunk_end - chunk_start + overlap) as usize)?;
                let mut last = None;
                pattern.find_all(&chunk, |position| {
                    let offset = chunk_start + position as u64;
                    if offset < chunk_end {
                        last = Some(offset);
                    }
                    true
                });
                if let Some(offset) = last {
                    result.matches.push(offset);
                    break;
                }
                progress(len - chunk_start);
                chunk_end = chunk_start;
            }
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(text: &str) -> Pattern {
        SearchQuery::Hex {
            text: text.to_string(),
        }
        .to_pattern()
        .unwrap()
    }

    fn run(
        pattern: &Pattern,
        data: &[u8],
        from: u64,
        direction: SearchDirection,
        limit: usize,
    ) -> SearchResult {
        search(
            pattern,
            data.len() as u64,
            SearchOptions {
                from,
                direction,
                limit,
            },
            &AtomicBool::new(false),
            |offset, length| {
                let start = offset as usize;
                let end = (start + length).min(data.len());
                Ok(data[start.min(end)..end].to_vec())
            },
            |_| {},
        )
        .unwrap()
    }

    #[test]
    fn hex_patterns_with_wildcards() {
        assert_eq!(
            hex("48 65").matchers,
            vec![ByteMatcher::Exact(0x48), ByteMatcher::Exact(0x65)]
        );
        assert_eq!(hex("0x4865"), hex("48 65"));
        assert_eq!(
            hex("?? 4?").matchers,
            vec![
                ByteMatcher::Masked { value: 0, mask: 0 },
                ByteMatcher::Masked {
                    value: 0x40,
                    mask: 0xf0
                }
            ]
        );
        assert!(SearchQuery::Hex { text: "4".into() }.to_pattern().is_err());
        assert!(SearchQuery::Hex { text: "zz".into() }.to_pattern().is_err());
        assert!(SearchQuery::Hex { text: " ".into() }.to_pattern().is_err());
    }

    #[test]
    fn text_in_encodings() {
        let pattern = |text: &str, encoding| {
            SearchQuery::Text {
                text: text.into(),
                encoding,
                ignore_case: false,
            }
            .to_pattern()
        };
        let bytes = |p: Pattern| p.exact_bytes().unwrap();

        assert_eq!(bytes(pattern("Hi", TextEncoding::Ascii).unwrap()), b"Hi");
        assert_eq!(
            bytes(pattern("é", TextEncoding::Utf8).unwrap()),
            [0xc3, 0xa9]
        );
        assert_eq!(
            bytes(pattern("A", TextEncoding::Utf16Le).unwrap()),
            [0x41, 0]
        );
        assert_eq!(
            bytes(pattern("A", TextEncoding::Utf16Be).unwrap()),
            [0, 0x41]
        );
        assert_eq!(
            bytes(pattern("😀", TextEncoding::Utf16Le).unwrap()),
            [0x3d, 0xd8, 0x00, 0xde]
        );
        assert_eq!(
            bytes(pattern("A", TextEncoding::Utf32Be).unwrap()),
            [0, 0, 0, 0x41]
        );
        assert!(pattern("é", TextEncoding::Ascii).is_err());
    }

    #[test]
    fn numbers_in_both_byte_orders() {
        let number = |text: &str, kind, big_endian| {
            SearchQuery::Number {
                text: text.into(),
                kind,
                big_endian,
            }
            .to_pattern()
            .map(|p| p.exact_bytes().unwrap())
        };

        assert_eq!(number("258", NumberKind::U16, false).unwrap(), [2, 1]);
        assert_eq!(number("258", NumberKind::U16, true).unwrap(), [1, 2]);
        assert_eq!(number("0x0102", NumberKind::U16, true).unwrap(), [1, 2]);
        assert_eq!(number("-1", NumberKind::I32, false).unwrap(), [0xff; 4]);
        assert_eq!(
            number("1.5", NumberKind::F32, false).unwrap(),
            1.5f32.to_le_bytes()
        );
        assert!(number("256", NumberKind::U8, false).is_err());
        assert!(number("-1", NumberKind::U32, false).is_err());
        assert!(number("abc", NumberKind::F64, false).is_err());
    }

    #[test]
    fn ignore_case_folds_ascii_letters() {
        let pattern = SearchQuery::Text {
            text: "Ab1".into(),
            encoding: TextEncoding::Ascii,
            ignore_case: true,
        }
        .to_pattern()
        .unwrap();

        let result = run(&pattern, b"xxaB1 AB1 ab2", 0, SearchDirection::All, 10);
        assert_eq!(result.matches, vec![2, 6]);
    }

    #[test]
    fn find_next_previous_and_all() {
        let data = b"abcXYabcXYabc";
        let pattern = hex("61 62 63"); // "abc"

        assert_eq!(
            run(&pattern, data, 0, SearchDirection::Next, 0).matches,
            vec![0]
        );
        assert_eq!(
            run(&pattern, data, 1, SearchDirection::Next, 0).matches,
            vec![5]
        );
        assert!(run(&pattern, data, 11, SearchDirection::Next, 0)
            .matches
            .is_empty());

        assert_eq!(
            run(&pattern, data, 13, SearchDirection::Previous, 0).matches,
            vec![10]
        );
        assert_eq!(
            run(&pattern, data, 10, SearchDirection::Previous, 0).matches,
            vec![5]
        );
        assert!(run(&pattern, data, 0, SearchDirection::Previous, 0)
            .matches
            .is_empty());

        let all = run(&pattern, data, 0, SearchDirection::All, 10);
        assert_eq!(all.matches, vec![0, 5, 10]);
        assert_eq!(all.match_length, 3);
        assert!(!all.truncated);

        let limited = run(&pattern, data, 0, SearchDirection::All, 2);
        assert_eq!(limited.matches, vec![0, 5]);
        assert!(limited.truncated);
    }

    #[test]
    fn wildcard_search() {
        let data = [0x10, 0x41, 0x20, 0x4f, 0x30, 0x51];
        let result = run(&hex("4?"), &data, 0, SearchDirection::All, 10);
        assert_eq!(result.matches, vec![1, 3]);

        let result = run(&hex("?? 4f"), &data, 0, SearchDirection::All, 10);
        assert_eq!(result.matches, vec![2]);
    }

    #[test]
    fn matches_across_chunk_boundaries_are_found_once() {
        let chunk = SEARCH_CHUNK_LENGTH;
        let mut data = vec![0u8; chunk * 3 + 10];
        // One match straddling the first boundary, one exactly at the second, one at the end.
        let positions = [chunk - 2, chunk * 2, data.len() - 4];
        for &position in &positions {
            data[position..position + 4].copy_from_slice(b"FIND");
        }
        let pattern = hex("46 49 4e 44");

        let all = run(&pattern, &data, 0, SearchDirection::All, 100);
        assert_eq!(
            all.matches,
            positions.iter().map(|&p| p as u64).collect::<Vec<_>>()
        );

        assert_eq!(
            run(&pattern, &data, chunk as u64, SearchDirection::Next, 0).matches,
            vec![(chunk * 2) as u64]
        );
        assert_eq!(
            run(
                &pattern,
                &data,
                (chunk * 2) as u64,
                SearchDirection::Previous,
                0
            )
            .matches,
            vec![(chunk - 2) as u64]
        );
        assert_eq!(
            run(
                &pattern,
                &data,
                data.len() as u64,
                SearchDirection::Previous,
                0
            )
            .matches,
            vec![(data.len() - 4) as u64]
        );
    }

    #[test]
    fn overlapping_matches_are_all_found() {
        let result = run(&hex("61 61"), b"aaaa", 0, SearchDirection::All, 10);
        assert_eq!(result.matches, vec![0, 1, 2]);
    }

    #[test]
    fn pattern_longer_than_content_finds_nothing() {
        let result = run(&hex("01 02 03"), b"\x01\x02", 0, SearchDirection::All, 10);
        assert!(result.matches.is_empty());
    }

    #[test]
    fn cancelled_search_stops() {
        let data = vec![0u8; SEARCH_CHUNK_LENGTH * 2];
        let cancel = AtomicBool::new(true);
        let result = search(
            &hex("01"),
            data.len() as u64,
            SearchOptions {
                from: 0,
                direction: SearchDirection::All,
                limit: 10,
            },
            &cancel,
            |offset, length| {
                let start = offset as usize;
                Ok(data[start..(start + length).min(data.len())].to_vec())
            },
            |_| {},
        )
        .unwrap();
        assert!(result.cancelled);
    }

    /// The JSON shapes are part of the contract with the types in `TauriWrappers.ts`.
    #[test]
    fn queries_deserialize_from_frontend_json() {
        let query = |json: &str| serde_json::from_str::<SearchQuery>(json).unwrap();

        assert_eq!(
            query(r#"{"type":"hex","text":"48 ??"}"#),
            SearchQuery::Hex {
                text: "48 ??".into()
            }
        );
        assert_eq!(
            query(r#"{"type":"text","text":"Hi","encoding":"utf16Le","ignoreCase":true}"#),
            SearchQuery::Text {
                text: "Hi".into(),
                encoding: TextEncoding::Utf16Le,
                ignore_case: true,
            }
        );
        assert_eq!(
            query(r#"{"type":"number","text":"1","kind":"f64","bigEndian":true}"#),
            SearchQuery::Number {
                text: "1".into(),
                kind: NumberKind::F64,
                big_endian: true,
            }
        );
        assert_eq!(
            serde_json::from_str::<SearchDirection>(r#""previous""#).unwrap(),
            SearchDirection::Previous
        );
        assert!(serde_json::from_str::<SearchQuery>(r#"{"type":"regex","text":"a"}"#).is_err());
    }

    #[test]
    fn result_serializes_in_camel_case() {
        let result = SearchResult {
            matches: vec![1, 5],
            match_length: 2,
            truncated: false,
            cancelled: true,
        };
        assert_eq!(
            serde_json::to_value(result).unwrap(),
            serde_json::json!({ "matches": [1, 5], "matchLength": 2, "truncated": false, "cancelled": true })
        );
    }

    #[test]
    fn pattern_length_is_limited() {
        let at_limit = "00".repeat(MAX_PATTERN_LENGTH);
        assert_eq!(
            SearchQuery::Hex { text: at_limit }
                .to_pattern()
                .unwrap()
                .len(),
            MAX_PATTERN_LENGTH
        );

        let too_long = "00".repeat(MAX_PATTERN_LENGTH + 1);
        assert!(SearchQuery::Hex { text: too_long }.to_pattern().is_err());
    }

    #[test]
    fn integer_limits_and_hex_negatives() {
        let number = |text: &str, kind| {
            SearchQuery::Number {
                text: text.into(),
                kind,
                big_endian: false,
            }
            .to_pattern()
            .map(|p| p.exact_bytes().unwrap())
        };

        assert_eq!(number("-128", NumberKind::I8).unwrap(), [0x80]);
        assert!(number("-129", NumberKind::I8).is_err());
        assert_eq!(number("-0x80", NumberKind::I8).unwrap(), [0x80]);
        assert_eq!(number("0XFF", NumberKind::U8).unwrap(), [0xff]);
        assert_eq!(
            number("18446744073709551615", NumberKind::U64).unwrap(),
            [0xff; 8]
        );
        assert!(number("18446744073709551616", NumberKind::U64).is_err());
        assert!(number("", NumberKind::U16).is_err());
        assert!(number("1.5", NumberKind::U32).is_err());
    }

    #[test]
    fn empty_text_is_an_error() {
        let query = SearchQuery::Text {
            text: String::new(),
            encoding: TextEncoding::Utf8,
            ignore_case: false,
        };
        assert!(query.to_pattern().is_err());
    }
}
