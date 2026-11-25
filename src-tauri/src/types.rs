use std::{fs::File, sync::Mutex};

use serde::{Deserialize, Serialize};

/// The application file state for the Tauri application.
pub struct AppFileState {
    pub file: File,
    pub file_name: String,
    pub file_index: i32,
    pub file_size: u64,
    pub prev_seek_pos: u64,
    pub bytes_at_pos: [u8; 1024],
}

/// The application default state for the Tauri application.
impl ::std::default::Default for AppState {
    fn default() -> Self {
        Self {
            file: Mutex::new(Vec::new()),
        }
    }
}

#[derive(Serialize, Deserialize)]
pub struct DataInPosition {
    pub value_le_u8: String,
    pub value_le_i8: String,
    pub value_le_u16: String,
    pub value_le_i16: String,
    pub value_le_u32: String,
    pub value_le_i32: String,
    pub value_le_u64: String,
    pub value_le_i64: String,
    pub value_le_u128: String,
    pub value_le_i128: String,
    pub value_le_f32: String,
    pub value_le_f64: String,
    pub char_le_ascii: String,
    pub char_le_utf8: String,
    pub char_le_utf16: String,
    pub char_le_utf32: String,
    pub value_be_u8: String,
    pub value_be_i8: String,
    pub value_be_u16: String,
    pub value_be_i16: String,
    pub value_be_u32: String,
    pub value_be_i32: String,
    pub value_be_u64: String,
    pub value_be_i64: String,
    pub value_be_u128: String,
    pub value_be_i128: String,
    pub value_be_f32: String,
    pub value_be_f64: String,
    pub char_be_ascii: String,
    pub char_be_utf8: String,
    pub char_be_utf16: String,
    pub char_be_utf32: String,
}

/// The application state for the Tauri application.
pub struct AppState {
    pub file: Mutex<Vec<AppFileState>>,
}

/// The application state seriazable result data.
#[derive(Serialize, Deserialize)]
pub struct AppFileStateResult {
    pub file_name: String,
    pub file_name_no_path: String,
    pub file_index: usize,
    pub file_size: u64,
}
