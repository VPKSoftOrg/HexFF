// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use config::{get_app_config, set_app_config, AppConfig};
use documents::{
    lock_document, Document, DocumentId, DocumentInfo, DocumentStore, MAX_READ_LENGTH,
};
use inspect::{
    inspect_data as inspect_data_bytes, inspect_text as inspect_text_bytes, DataInPosition,
    TextDataInPosition, DATA_INSPECTOR_LENGTH,
};
use std::path::PathBuf;
use tauri::{ipc::Response, State};

mod config;
mod documents;
mod history;
mod inspect;
mod piece_table;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(DocumentStore::default())
        .invoke_handler(tauri::generate_handler![
            load_settings,
            save_settings,
            open_file,
            close_file,
            get_open_files,
            read_range,
            inspect_data,
            inspect_text,
            edit_document,
            undo_edit,
            redo_edit
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Runs blocking file I/O on the blocking thread pool so it doesn't stall the async runtime.
async fn run_blocking<T: Send + 'static>(
    task: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|e| e.to_string())?
}

/// Reads up to `length` bytes of an open document starting from `offset`.
async fn read_document(
    store: &DocumentStore,
    id: DocumentId,
    offset: u64,
    length: usize,
) -> Result<Vec<u8>, String> {
    let document = store.get(id)?;
    run_blocking(move || {
        lock_document(&document)?
            .read_range(offset, length)
            .map_err(|e| e.to_string())
    })
    .await
}

/// Loads the application settings requested by the frontend.
#[tauri::command]
async fn load_settings() -> AppConfig {
    get_app_config()
}

/// Saves the settings passed from the frontend.
///
/// # Returns
/// `true` if the settings were saved successfully; `false` otherwise.
#[tauri::command]
async fn save_settings(config: AppConfig) -> bool {
    set_app_config(config)
}

/// Opens a file for reading.
///
/// If the file is already open, the existing document is returned.
#[tauri::command]
async fn open_file(path: String, store: State<'_, DocumentStore>) -> Result<DocumentInfo, String> {
    let id = store.next_id();
    let document = run_blocking(move || {
        let path = PathBuf::from(&path);
        Document::open(id, &path).map_err(|e| format!("{}: {e}", path.display()))
    })
    .await?;

    store.insert(document)
}

/// Closes an open document.
#[tauri::command]
fn close_file(id: DocumentId, store: State<'_, DocumentStore>) -> Result<(), String> {
    store.close(id)
}

/// Lists the open documents in the order they were opened.
#[tauri::command]
fn get_open_files(store: State<'_, DocumentStore>) -> Result<Vec<DocumentInfo>, String> {
    store.list()
}

/// Reads a range of bytes from an open document.
///
/// The bytes are returned as raw binary (an `ArrayBuffer` in the frontend). The result is shorter
/// than `length` when the range extends past the end of the file.
#[tauri::command]
async fn read_range(
    id: DocumentId,
    offset: u64,
    length: usize,
    store: State<'_, DocumentStore>,
) -> Result<Response, String> {
    if length > MAX_READ_LENGTH {
        return Err(format!(
            "Read length {length} exceeds the maximum of {MAX_READ_LENGTH} bytes"
        ));
    }

    let bytes = read_document(&store, id, offset, length).await?;
    Ok(Response::new(bytes))
}

/// Interprets the bytes at `offset` as numbers and characters for the data inspector.
#[tauri::command]
async fn inspect_data(
    id: DocumentId,
    offset: u64,
    store: State<'_, DocumentStore>,
) -> Result<DataInPosition, String> {
    let bytes = read_document(&store, id, offset, DATA_INSPECTOR_LENGTH).await?;
    Ok(inspect_data_bytes(&bytes))
}

/// Decodes `length` bytes starting at `offset` as text for the text inspector.
#[tauri::command]
async fn inspect_text(
    id: DocumentId,
    offset: u64,
    length: usize,
    store: State<'_, DocumentStore>,
) -> Result<TextDataInPosition, String> {
    if length > MAX_READ_LENGTH {
        return Err(format!(
            "Read length {length} exceeds the maximum of {MAX_READ_LENGTH} bytes"
        ));
    }

    let bytes = read_document(&store, id, offset, length).await?;
    Ok(inspect_text_bytes(&bytes))
}

/// The result of undo or redo: the updated document and the offset of the change, if there was one.
#[derive(serde::Serialize)]
struct UndoResult {
    document: DocumentInfo,
    offset: Option<u64>,
}

/// Runs `action` on an open document and stores its updated information.
async fn change_document<T: Send + 'static>(
    store: &DocumentStore,
    id: DocumentId,
    action: impl FnOnce(&mut Document) -> Result<T, String> + Send + 'static,
) -> Result<(T, DocumentInfo), String> {
    let document = store.get(id)?;
    let (result, info) = run_blocking(move || {
        let mut document = lock_document(&document)?;
        let result = action(&mut document)?;
        Ok((result, document.info()))
    })
    .await?;
    store.update_info(&info)?;
    Ok((result, info))
}

/// Replaces `remove_length` bytes at `offset` with `data` in an open document.
///
/// Overwriting, inserting and deleting are all replacements. With `continue_step`, the edit is
/// undone together with the previous one (e.g. consecutive keystrokes).
#[tauri::command]
async fn edit_document(
    id: DocumentId,
    offset: u64,
    remove_length: u64,
    data: Vec<u8>,
    continue_step: bool,
    store: State<'_, DocumentStore>,
) -> Result<DocumentInfo, String> {
    let (_, info) = change_document(&store, id, move |document| {
        document.edit(offset, remove_length, &data, continue_step)
    })
    .await?;
    Ok(info)
}

/// Undoes the latest edit step of an open document.
#[tauri::command]
async fn undo_edit(id: DocumentId, store: State<'_, DocumentStore>) -> Result<UndoResult, String> {
    let (offset, document) = change_document(&store, id, |document| Ok(document.undo())).await?;
    Ok(UndoResult { document, offset })
}

/// Redoes the latest undone edit step of an open document.
#[tauri::command]
async fn redo_edit(id: DocumentId, store: State<'_, DocumentStore>) -> Result<UndoResult, String> {
    let (offset, document) = change_document(&store, id, |document| Ok(document.redo())).await?;
    Ok(UndoResult { document, offset })
}
