// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use config::{get_app_config, set_app_config, AppConfig};
use documents::{
    lock_document, Document, DocumentId, DocumentInfo, DocumentStore, SaveResult, MAX_READ_LENGTH,
};
use inspect::{
    inspect_data as inspect_data_bytes, inspect_text as inspect_text_bytes, DataInPosition,
    TextDataInPosition, DATA_INSPECTOR_LENGTH,
};
use search::{SearchDirection, SearchOptions, SearchQuery, SearchResult};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{ipc::Response, AppHandle, Emitter, State};

mod config;
mod documents;
mod history;
mod inspect;
mod piece_table;
mod search;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(DocumentStore::default())
        .manage(SearchRegistry::default())
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
            redo_edit,
            save_file,
            save_file_as,
            check_file_changed,
            reload_file,
            search_document,
            cancel_search
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
    let (result, info, canonical_path) = run_blocking(move || {
        let mut document = lock_document(&document)?;
        let result = action(&mut document)?;
        Ok((
            result,
            document.info(),
            document.canonical_path().to_path_buf(),
        ))
    })
    .await?;
    store.update_info(&info, &canonical_path)?;
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

/// The result of saving a document.
#[derive(serde::Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
enum SaveOutcome {
    /// The document was saved.
    Saved { document: DocumentInfo },
    /// Nothing was written because another program changed the file; save again with `force` to overwrite.
    ChangedOnDisk,
    /// Nothing was written because another program rewrote the open file in place, so the document's
    /// version can't be saved; the file has to be reloaded.
    ChangedInPlace,
}

impl SaveOutcome {
    fn new(result: SaveResult, document: DocumentInfo) -> Self {
        match result {
            SaveResult::Saved => Self::Saved { document },
            SaveResult::ChangedOnDisk => Self::ChangedOnDisk,
            SaveResult::ChangedInPlace => Self::ChangedInPlace,
        }
    }
}

/// Saves an open document to its file.
///
/// Without `force`, a file that another program changed since it was opened is not overwritten.
#[tauri::command]
async fn save_file(
    id: DocumentId,
    force: bool,
    store: State<'_, DocumentStore>,
) -> Result<SaveOutcome, String> {
    let (result, document) = change_document(&store, id, move |document| {
        document.save(force).map_err(|e| e.to_string())
    })
    .await?;
    Ok(SaveOutcome::new(result, document))
}

/// Saves an open document to a new file, which the document then refers to.
#[tauri::command]
async fn save_file_as(
    id: DocumentId,
    path: String,
    store: State<'_, DocumentStore>,
) -> Result<SaveOutcome, String> {
    let path = PathBuf::from(path);
    if store.is_open_elsewhere(id, &path)? {
        return Err(format!(
            "{} is open in another tab; close it first",
            path.display()
        ));
    }
    let (result, document) = change_document(&store, id, move |document| {
        document
            .save_as(&path)
            .map_err(|e| format!("{}: {e}", path.display()))
    })
    .await?;
    Ok(SaveOutcome::new(result, document))
}

/// Checks whether another program changed an open document's file since it was opened, saved or reloaded.
#[tauri::command]
async fn check_file_changed(
    id: DocumentId,
    store: State<'_, DocumentStore>,
) -> Result<bool, String> {
    let document = store.get(id)?;
    run_blocking(move || Ok(lock_document(&document)?.changed_on_disk())).await
}

/// Discards the edits of an open document and reads its file from disk again.
#[tauri::command]
async fn reload_file(
    id: DocumentId,
    store: State<'_, DocumentStore>,
) -> Result<DocumentInfo, String> {
    let (_, document) = change_document(&store, id, |document| {
        document.reload().map_err(|e| e.to_string())
    })
    .await?;
    Ok(document)
}

/// The cancel flags of running searches, by the search id the frontend chose.
#[derive(Default)]
struct SearchRegistry {
    cancel_flags: Mutex<HashMap<u64, Arc<AtomicBool>>>,
}

/// The largest number of matches a "find all" search returns.
const MAX_SEARCH_RESULTS: usize = 10_000;

/// How often search progress is reported at most.
const SEARCH_PROGRESS_INTERVAL: Duration = Duration::from_millis(100);

/// Search progress, sent as the `search-progress` event.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchProgress {
    search_id: u64,
    /// The number of bytes scanned so far.
    scanned: u64,
    /// The size of the content being searched.
    total: u64,
}

/// Searches an open document.
///
/// The document is locked only while each chunk is read, so it stays readable during a long
/// search. Progress is sent as `search-progress` events; `cancel_search` with the same
/// `search_id` stops the search, which then returns the matches found so far.
#[tauri::command]
#[allow(clippy::too_many_arguments)] // Tauri commands receive their arguments one by one.
async fn search_document(
    id: DocumentId,
    search_id: u64,
    query: SearchQuery,
    from: u64,
    direction: SearchDirection,
    app: AppHandle,
    store: State<'_, DocumentStore>,
    registry: State<'_, SearchRegistry>,
) -> Result<SearchResult, String> {
    let pattern = query.to_pattern()?;
    let document = store.get(id)?;
    let cancel = Arc::new(AtomicBool::new(false));
    registry
        .cancel_flags
        .lock()
        .map_err(|e| e.to_string())?
        .insert(search_id, Arc::clone(&cancel));

    let result = run_blocking(move || {
        let total = lock_document(&document)?.size();
        let mut last_progress = Instant::now();
        search::search(
            &pattern,
            total,
            SearchOptions {
                from,
                direction,
                limit: MAX_SEARCH_RESULTS,
            },
            &cancel,
            |offset, length| {
                lock_document(&document)
                    .map_err(std::io::Error::other)?
                    .read_range(offset, length)
            },
            |scanned| {
                if last_progress.elapsed() >= SEARCH_PROGRESS_INTERVAL {
                    last_progress = Instant::now();
                    let _ = app.emit(
                        "search-progress",
                        SearchProgress {
                            search_id,
                            scanned,
                            total,
                        },
                    );
                }
            },
        )
        .map_err(|e| e.to_string())
    })
    .await;

    if let Ok(mut flags) = registry.cancel_flags.lock() {
        flags.remove(&search_id);
    }
    result
}

/// Cancels a running search. Cancelling a search that already finished does nothing.
#[tauri::command]
fn cancel_search(search_id: u64, registry: State<'_, SearchRegistry>) -> Result<(), String> {
    if let Some(flag) = registry
        .cancel_flags
        .lock()
        .map_err(|e| e.to_string())?
        .get(&search_id)
    {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}
