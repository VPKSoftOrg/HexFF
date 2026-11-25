//! Interpretations of raw bytes for the data and text inspectors.
//!
//! A value that needs more bytes than are available (for example a `u64` read
//! three bytes before the end of the file) is `None` instead of being padded.

use serde::Serialize;

/// The number of bytes the data inspector needs at most (the size of a `u128`).
pub const DATA_INSPECTOR_LENGTH: usize = 16;

/// The values of the bytes at a file position interpreted as different types.
#[derive(Debug, Serialize, Default, PartialEq)]
pub struct DataInPosition {
    pub value_le_u8: Option<String>,
    pub value_le_i8: Option<String>,
    pub value_le_u16: Option<String>,
    pub value_le_i16: Option<String>,
    pub value_le_u32: Option<String>,
    pub value_le_i32: Option<String>,
    pub value_le_u64: Option<String>,
    pub value_le_i64: Option<String>,
    pub value_le_u128: Option<String>,
    pub value_le_i128: Option<String>,
    pub value_le_f32: Option<String>,
    pub value_le_f64: Option<String>,
    pub char_le_ascii: Option<String>,
    pub char_le_utf8: Option<String>,
    pub char_le_utf16: Option<String>,
    pub char_le_utf32: Option<String>,
    pub value_be_u8: Option<String>,
    pub value_be_i8: Option<String>,
    pub value_be_u16: Option<String>,
    pub value_be_i16: Option<String>,
    pub value_be_u32: Option<String>,
    pub value_be_i32: Option<String>,
    pub value_be_u64: Option<String>,
    pub value_be_i64: Option<String>,
    pub value_be_u128: Option<String>,
    pub value_be_i128: Option<String>,
    pub value_be_f32: Option<String>,
    pub value_be_f64: Option<String>,
    pub char_be_ascii: Option<String>,
    pub char_be_utf8: Option<String>,
    pub char_be_utf16: Option<String>,
    pub char_be_utf32: Option<String>,
}

/// A range of bytes decoded as text, one cell per byte.
///
/// A decoded character is placed in the cell of its first byte and the cells of its
/// remaining bytes are empty. Bytes that don't decode, and control characters, are shown as `.`.
#[derive(Debug, Serialize, Default, PartialEq)]
pub struct TextDataInPosition {
    pub text_ascii: Vec<String>,
    pub text_utf8: Vec<String>,
    pub text_le_utf16: Vec<String>,
    pub text_be_utf16: Vec<String>,
    pub text_le_utf32: Vec<String>,
    pub text_be_utf32: Vec<String>,
}

/// The cell text for bytes that can't be shown as a character.
const NOT_PRINTABLE: &str = ".";

/// Takes the first `N` bytes of `data`, if there are that many.
fn take<const N: usize>(data: &[u8]) -> Option<[u8; N]> {
    data.get(..N)?.try_into().ok()
}

/// Interprets the bytes at the start of `data` as numbers and characters.
pub fn inspect_data(data: &[u8]) -> DataInPosition {
    macro_rules! number {
        ($type:ty, $from:ident) => {
            take::<{ std::mem::size_of::<$type>() }>(data).map(|b| <$type>::$from(b).to_string())
        };
    }
    macro_rules! float {
        ($type:ty, $from:ident) => {
            take::<{ std::mem::size_of::<$type>() }>(data)
                .map(|b| format!("{:e}", <$type>::$from(b)))
        };
    }

    let ascii = data
        .first()
        .filter(|b| b.is_ascii())
        .map(|b| escape_char(char::from(*b)));
    let utf8 = decode_utf8_char(data).map(|(c, _)| escape_char(c));

    DataInPosition {
        value_le_u8: number!(u8, from_le_bytes),
        value_le_i8: number!(i8, from_le_bytes),
        value_le_u16: number!(u16, from_le_bytes),
        value_le_i16: number!(i16, from_le_bytes),
        value_le_u32: number!(u32, from_le_bytes),
        value_le_i32: number!(i32, from_le_bytes),
        value_le_u64: number!(u64, from_le_bytes),
        value_le_i64: number!(i64, from_le_bytes),
        value_le_u128: number!(u128, from_le_bytes),
        value_le_i128: number!(i128, from_le_bytes),
        value_le_f32: float!(f32, from_le_bytes),
        value_le_f64: float!(f64, from_le_bytes),
        char_le_ascii: ascii.clone(),
        char_le_utf8: utf8.clone(),
        char_le_utf16: decode_utf16_char(data, false).map(|(c, _)| escape_char(c)),
        char_le_utf32: decode_utf32_char(data, false).map(escape_char),
        value_be_u8: number!(u8, from_be_bytes),
        value_be_i8: number!(i8, from_be_bytes),
        value_be_u16: number!(u16, from_be_bytes),
        value_be_i16: number!(i16, from_be_bytes),
        value_be_u32: number!(u32, from_be_bytes),
        value_be_i32: number!(i32, from_be_bytes),
        value_be_u64: number!(u64, from_be_bytes),
        value_be_i64: number!(i64, from_be_bytes),
        value_be_u128: number!(u128, from_be_bytes),
        value_be_i128: number!(i128, from_be_bytes),
        value_be_f32: float!(f32, from_be_bytes),
        value_be_f64: float!(f64, from_be_bytes),
        // ASCII and UTF-8 have no byte order; both fields hold the same value.
        char_be_ascii: ascii,
        char_be_utf8: utf8,
        char_be_utf16: decode_utf16_char(data, true).map(|(c, _)| escape_char(c)),
        char_be_utf32: decode_utf32_char(data, true).map(escape_char),
    }
}

/// Decodes `data` as text in each supported encoding.
pub fn inspect_text(data: &[u8]) -> TextDataInPosition {
    TextDataInPosition {
        text_ascii: data
            .iter()
            .map(|b| {
                if b.is_ascii() {
                    display_char(char::from(*b))
                } else {
                    NOT_PRINTABLE.to_string()
                }
            })
            .collect(),
        text_utf8: decode_cells(data, 1, decode_utf8_char),
        text_le_utf16: decode_cells(data, 2, |d| decode_utf16_char(d, false)),
        text_be_utf16: decode_cells(data, 2, |d| decode_utf16_char(d, true)),
        text_le_utf32: decode_cells(data, 4, |d| decode_utf32_char(d, false).map(|c| (c, 4))),
        text_be_utf32: decode_cells(data, 4, |d| decode_utf32_char(d, true).map(|c| (c, 4))),
    }
}

/// Decodes `data` into one cell per byte using `decode`, which returns a character and the
/// number of bytes it used. When decoding fails, `unit` bytes are skipped.
fn decode_cells(
    data: &[u8],
    unit: usize,
    decode: impl Fn(&[u8]) -> Option<(char, usize)>,
) -> Vec<String> {
    let mut cells = vec![String::new(); data.len()];
    let mut position = 0;

    while position < data.len() {
        let (text, used) = match decode(&data[position..]) {
            Some((c, used)) => (display_char(c), used),
            None if data.len() - position < unit => (String::new(), unit),
            None => (NOT_PRINTABLE.to_string(), unit),
        };
        cells[position] = text;
        position += used;
    }

    cells
}

/// Decodes the UTF-8 character at the start of `data`.
fn decode_utf8_char(data: &[u8]) -> Option<(char, usize)> {
    let width = match data.first()? {
        0x00..=0x7f => 1,
        0xc2..=0xdf => 2,
        0xe0..=0xef => 3,
        0xf0..=0xf4 => 4,
        _ => return None,
    };
    let text = std::str::from_utf8(data.get(..width)?).ok()?;
    text.chars().next().map(|c| (c, width))
}

/// Decodes the UTF-16 character at the start of `data`, including surrogate pairs.
fn decode_utf16_char(data: &[u8], big_endian: bool) -> Option<(char, usize)> {
    let unit = |bytes: [u8; 2]| {
        if big_endian {
            u16::from_be_bytes(bytes)
        } else {
            u16::from_le_bytes(bytes)
        }
    };

    let first = unit(take::<2>(data)?);
    if let Some(c) = char::from_u32(u32::from(first)) {
        return Some((c, 2));
    }

    let second = unit(take::<2>(data.get(2..)?)?);
    char::decode_utf16([first, second])
        .next()?
        .ok()
        .map(|c| (c, 4))
}

/// Decodes the UTF-32 character at the start of `data`.
fn decode_utf32_char(data: &[u8], big_endian: bool) -> Option<char> {
    let bytes = take::<4>(data)?;
    let value = if big_endian {
        u32::from_be_bytes(bytes)
    } else {
        u32::from_le_bytes(bytes)
    };
    char::from_u32(value)
}

/// Formats a character for the text inspector grid.
fn display_char(c: char) -> String {
    if c.is_control() {
        NOT_PRINTABLE.to_string()
    } else {
        c.to_string()
    }
}

/// Formats a character for the data inspector, escaping control characters (e.g. `\n`).
fn escape_char(c: char) -> String {
    if c.is_control() {
        c.escape_debug().to_string()
    } else {
        c.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cells(values: &[&str]) -> Vec<String> {
        values.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn numbers_in_both_byte_orders() {
        let data = inspect_data(&[0x01, 0x02, 0x03, 0x04]);

        assert_eq!(data.value_le_u8.as_deref(), Some("1"));
        assert_eq!(data.value_le_u16.as_deref(), Some("513"));
        assert_eq!(data.value_be_u16.as_deref(), Some("258"));
        assert_eq!(data.value_le_u32.as_deref(), Some("67305985"));
        assert_eq!(data.value_be_u32.as_deref(), Some("16909060"));
    }

    #[test]
    fn signed_numbers() {
        let data = inspect_data(&[0xff, 0xff]);

        assert_eq!(data.value_le_i8.as_deref(), Some("-1"));
        assert_eq!(data.value_le_i16.as_deref(), Some("-1"));
        assert_eq!(data.value_le_u16.as_deref(), Some("65535"));
    }

    #[test]
    fn values_needing_more_bytes_than_available_are_none() {
        let data = inspect_data(&[0x01, 0x02, 0x03]);

        assert!(data.value_le_u16.is_some());
        assert!(data.value_le_u32.is_none());
        assert!(data.value_be_u64.is_none());
        assert!(data.value_le_f32.is_none());
        assert!(data.value_le_u128.is_none());
    }

    #[test]
    fn empty_data_has_no_values() {
        assert_eq!(inspect_data(&[]), DataInPosition::default());
    }

    #[test]
    fn floats() {
        let data = inspect_data(&1.5f32.to_le_bytes());

        assert_eq!(data.value_le_f32.as_deref(), Some("1.5e0"));
    }

    #[test]
    fn characters_at_position() {
        // "é" in UTF-8 is C3 A9.
        let data = inspect_data(&[0xc3, 0xa9]);
        assert_eq!(data.char_le_ascii, None);
        assert_eq!(data.char_le_utf8.as_deref(), Some("é"));
        assert_eq!(data.char_be_utf8.as_deref(), Some("é"));

        let data = inspect_data(&[0x41, 0x00, 0x00, 0x00]);
        assert_eq!(data.char_le_ascii.as_deref(), Some("A"));
        assert_eq!(data.char_le_utf16.as_deref(), Some("A"));
        assert_eq!(data.char_le_utf32.as_deref(), Some("A"));
        assert_eq!(data.char_be_utf16.as_deref(), Some("\u{4100}"));
        assert_eq!(data.char_be_utf32, None);
    }

    #[test]
    fn control_characters_are_escaped_in_data_inspector() {
        assert_eq!(inspect_data(b"\n").char_le_ascii.as_deref(), Some("\\n"));
    }

    #[test]
    fn utf8_needs_all_bytes_of_the_character() {
        // The first two bytes of the three-byte "€" (E2 82 AC).
        assert_eq!(inspect_data(&[0xe2, 0x82]).char_le_utf8, None);
    }

    #[test]
    fn text_ascii_marks_non_printable() {
        assert_eq!(
            inspect_text(b"A\n\x80z").text_ascii,
            cells(&["A", ".", ".", "z"])
        );
    }

    #[test]
    fn text_utf8_multi_byte_characters() {
        // "a€b" = 61 E2 82 AC 62
        assert_eq!(
            inspect_text("a€b".as_bytes()).text_utf8,
            cells(&["a", "€", "", "", "b"])
        );
    }

    #[test]
    fn text_utf8_invalid_bytes() {
        assert_eq!(inspect_text(&[0xff, 0x41]).text_utf8, cells(&[".", "A"]));
    }

    #[test]
    fn text_utf16_byte_orders() {
        let text = inspect_text(&[0x41, 0x00, 0x42, 0x00]);

        assert_eq!(text.text_le_utf16, cells(&["A", "", "B", ""]));
        assert_eq!(text.text_be_utf16, cells(&["\u{4100}", "", "\u{4200}", ""]));
    }

    #[test]
    fn text_utf16_surrogate_pair() {
        // U+1F600 in UTF-16 LE is 3D D8 00 DE.
        let text = inspect_text(&[0x3d, 0xd8, 0x00, 0xde, 0x41, 0x00]);

        assert_eq!(text.text_le_utf16, cells(&["😀", "", "", "", "A", ""]));
    }

    #[test]
    fn text_utf32_and_trailing_partial_unit() {
        let text = inspect_text(&[0x41, 0x00, 0x00, 0x00, 0x42]);

        assert_eq!(text.text_le_utf32, cells(&["A", "", "", "", ""]));
    }

    #[test]
    fn text_cells_match_input_length() {
        let data: Vec<u8> = (0..=255).collect();
        let text = inspect_text(&data);

        assert_eq!(text.text_ascii.len(), data.len());
        assert_eq!(text.text_utf8.len(), data.len());
        assert_eq!(text.text_le_utf16.len(), data.len());
        assert_eq!(text.text_be_utf32.len(), data.len());
    }
}
