use crate::history::{Change, History};
use crate::piece_table::PieceTable;
use serde::Serialize;
use std::collections::HashMap;
use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

/// A document identifier. Identifiers are never reused within an application run.
pub type DocumentId = u64;

/// The largest range a single `read_range` call may return.
pub const MAX_READ_LENGTH: usize = 16 * 1024 * 1024;

/// The largest number of bytes a single edit may insert.
pub const MAX_EDIT_LENGTH: usize = 16 * 1024 * 1024;

/// Information about an open document, sent to the frontend.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct DocumentInfo {
    /// The document identifier.
    pub id: DocumentId,
    /// The full path of the file as it was opened.
    pub path: String,
    /// The file name without the directory.
    pub name: String,
    /// The size of the edited content in bytes.
    pub size: u64,
    /// Whether the content differs from the file on disk.
    pub modified: bool,
    pub can_undo: bool,
    pub can_redo: bool,
}

/// An open file and its unsaved edits.
///
/// The file on disk is opened read-only and is not changed by edits; the edits live in a
/// [`PieceTable`] on top of it.
pub struct Document {
    id: DocumentId,
    path: PathBuf,
    canonical_path: PathBuf,
    file: File,
    table: PieceTable,
    history: History,
}

impl Document {
    /// Opens the file at `path` for reading.
    pub fn open(id: DocumentId, path: &Path) -> io::Result<Self> {
        let file = File::open(path)?;
        let metadata = file.metadata()?;
        if !metadata.is_file() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("'{}' is not a file", path.display()),
            ));
        }
        let canonical_path = path.canonicalize()?;

        Ok(Self {
            id,
            path: path.to_path_buf(),
            canonical_path,
            file,
            table: PieceTable::new(metadata.len()),
            history: History::default(),
        })
    }

    /// Gets the information about this document.
    pub fn info(&self) -> DocumentInfo {
        DocumentInfo {
            id: self.id,
            path: self.path.to_string_lossy().into_owned(),
            name: self
                .path
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| self.path.to_string_lossy().into_owned()),
            size: self.table.len(),
            modified: self.history.is_modified(),
            can_undo: self.history.can_undo(),
            can_redo: self.history.can_redo(),
        }
    }

    /// Reads up to `length` bytes of the edited content starting from `offset`.
    ///
    /// The result is shorter than `length` when the range extends past the end,
    /// and empty when `offset` is at or past the end.
    pub fn read_range(&mut self, offset: u64, length: usize) -> io::Result<Vec<u8>> {
        let file = &mut self.file;
        self.table.read(offset, length, |original_offset, buffer| {
            file.seek(SeekFrom::Start(original_offset))?;
            file.read_exact(buffer)
        })
    }

    /// Replaces `remove_len` bytes at `offset` with `data`.
    ///
    /// This covers overwriting (`remove_len` equal to the data length), inserting (`remove_len` 0)
    /// and deleting (empty `data`). `remove_len` is shortened at the end of the content.
    /// With `continue_step`, the edit is undone together with the previous one.
    pub fn edit(
        &mut self,
        offset: u64,
        remove_len: u64,
        data: &[u8],
        continue_step: bool,
    ) -> Result<(), String> {
        if offset > self.table.len() {
            return Err(format!(
                "Edit offset {offset} is past the end ({})",
                self.table.len()
            ));
        }
        if data.len() > MAX_EDIT_LENGTH {
            return Err(format!(
                "Edit length {} exceeds the maximum of {MAX_EDIT_LENGTH} bytes",
                data.len()
            ));
        }
        let remove_len = remove_len.min(self.table.len() - offset);
        if remove_len == 0 && data.is_empty() {
            return Ok(());
        }

        let change = Change::apply(&mut self.table, offset, remove_len, data);
        self.history.record(change, continue_step);
        Ok(())
    }

    /// Undoes the latest edit step. Returns its offset, or `None` if there was nothing to undo.
    pub fn undo(&mut self) -> Option<u64> {
        self.history.undo(&mut self.table)
    }

    /// Redoes the latest undone step. Returns its offset, or `None` if there was nothing to redo.
    pub fn redo(&mut self) -> Option<u64> {
        self.history.redo(&mut self.table)
    }
}

/// A shared, lockable document.
pub type SharedDocument = Arc<Mutex<Document>>;

/// A document in the store with the data needed for lookups, so that listing documents or
/// checking for duplicates never waits for a document that is busy with file I/O.
struct StoreEntry {
    info: DocumentInfo,
    canonical_path: PathBuf,
    document: SharedDocument,
}

type DocumentMap = HashMap<DocumentId, StoreEntry>;

/// The open documents of the application.
///
/// The map lock is only held for lookups and inserts; file I/O happens under the
/// lock of a single document so that reading one file never blocks another.
pub struct DocumentStore {
    next_id: AtomicU64,
    documents: Mutex<DocumentMap>,
}

impl Default for DocumentStore {
    fn default() -> Self {
        Self {
            next_id: AtomicU64::new(1),
            documents: Mutex::new(HashMap::new()),
        }
    }
}

impl DocumentStore {
    /// Reserves a new document identifier.
    pub fn next_id(&self) -> DocumentId {
        self.next_id.fetch_add(1, Ordering::Relaxed)
    }

    /// Adds an opened document to the store.
    ///
    /// If the same file is already open, the existing document is kept, `document` is dropped
    /// and the information of the existing document is returned.
    pub fn insert(&self, document: Document) -> Result<DocumentInfo, String> {
        let mut documents = self.lock_documents()?;

        if let Some(existing) = documents
            .values()
            .find(|entry| entry.canonical_path == document.canonical_path)
        {
            return Ok(existing.info.clone());
        }

        let info = document.info();
        documents.insert(
            info.id,
            StoreEntry {
                info: info.clone(),
                canonical_path: document.canonical_path.clone(),
                document: Arc::new(Mutex::new(document)),
            },
        );
        Ok(info)
    }

    /// Gets an open document.
    pub fn get(&self, id: DocumentId) -> Result<SharedDocument, String> {
        self.lock_documents()?
            .get(&id)
            .map(|entry| Arc::clone(&entry.document))
            .ok_or_else(|| format!("No open document with id {id}"))
    }

    /// Closes an open document.
    pub fn close(&self, id: DocumentId) -> Result<(), String> {
        self.lock_documents()?
            .remove(&id)
            .map(|_| ())
            .ok_or_else(|| format!("No open document with id {id}"))
    }

    /// Updates the stored information of a document after it changed.
    pub fn update_info(&self, info: &DocumentInfo) -> Result<(), String> {
        if let Some(entry) = self.lock_documents()?.get_mut(&info.id) {
            entry.info = info.clone();
        }
        Ok(())
    }

    /// Lists the open documents in the order they were opened.
    pub fn list(&self) -> Result<Vec<DocumentInfo>, String> {
        let mut result: Vec<DocumentInfo> = self
            .lock_documents()?
            .values()
            .map(|entry| entry.info.clone())
            .collect();
        result.sort_by_key(|info| info.id);
        Ok(result)
    }

    fn lock_documents(&self) -> Result<MutexGuard<'_, DocumentMap>, String> {
        self.documents.lock().map_err(|e| e.to_string())
    }
}

/// Locks a single document.
pub fn lock_document(document: &SharedDocument) -> Result<MutexGuard<'_, Document>, String> {
    document.lock().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn temp_file(content: &[u8]) -> tempfile::NamedTempFile {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        file.write_all(content).unwrap();
        file.flush().unwrap();
        file
    }

    #[test]
    fn read_range_returns_requested_bytes() {
        let file = temp_file(b"0123456789");
        let mut document = Document::open(1, file.path()).unwrap();

        assert_eq!(document.read_range(2, 3).unwrap(), b"234");
        assert_eq!(document.read_range(0, 10).unwrap(), b"0123456789");
    }

    #[test]
    fn read_range_is_shortened_at_end_of_file() {
        let file = temp_file(b"0123456789");
        let mut document = Document::open(1, file.path()).unwrap();

        assert_eq!(document.read_range(8, 100).unwrap(), b"89");
        assert!(document.read_range(10, 5).unwrap().is_empty());
        assert!(document.read_range(500, 5).unwrap().is_empty());
        assert!(document.read_range(0, 0).unwrap().is_empty());
    }

    #[test]
    fn opening_a_missing_file_is_an_error() {
        let directory = tempfile::tempdir().unwrap();
        let result = Document::open(1, &directory.path().join("missing.bin"));

        assert_eq!(result.err().unwrap().kind(), io::ErrorKind::NotFound);
    }

    #[test]
    fn opening_a_directory_is_an_error() {
        let directory = tempfile::tempdir().unwrap();

        assert!(Document::open(1, directory.path()).is_err());
    }

    #[test]
    fn info_contains_name_and_size() {
        let file = temp_file(b"abc");
        let document = Document::open(7, file.path()).unwrap();
        let info = document.info();

        assert_eq!(info.id, 7);
        assert_eq!(info.size, 3);
        assert!(!info.modified);
        assert!(!info.can_undo);
        assert_eq!(
            info.name,
            file.path().file_name().unwrap().to_string_lossy()
        );
    }

    #[test]
    fn edits_change_content_but_not_the_file() {
        let file = temp_file(b"0123456789");
        let mut document = Document::open(1, file.path()).unwrap();

        document.edit(2, 1, b"X", false).unwrap();
        document.edit(5, 0, b"ins", false).unwrap();
        document.edit(0, 2, b"", false).unwrap();

        assert_eq!(document.read_range(0, 100).unwrap(), b"X34ins56789");
        let info = document.info();
        assert_eq!(info.size, 11);
        assert!(info.modified);
        assert!(info.can_undo);
        assert_eq!(std::fs::read(file.path()).unwrap(), b"0123456789");
    }

    #[test]
    fn undo_and_redo_report_offsets() {
        let file = temp_file(b"0123456789");
        let mut document = Document::open(1, file.path()).unwrap();

        document.edit(4, 1, b"A", false).unwrap();
        document.edit(5, 1, b"B", true).unwrap();

        assert_eq!(document.undo(), Some(4));
        assert_eq!(document.read_range(0, 100).unwrap(), b"0123456789");
        assert!(!document.info().modified);
        assert!(document.info().can_redo);
        assert_eq!(document.undo(), None);

        assert_eq!(document.redo(), Some(4));
        assert_eq!(document.read_range(0, 100).unwrap(), b"0123AB6789");
    }

    #[test]
    fn edit_past_end_is_an_error_and_append_works() {
        let file = temp_file(b"ab");
        let mut document = Document::open(1, file.path()).unwrap();

        assert!(document.edit(3, 0, b"x", false).is_err());
        document.edit(2, 0, b"c", false).unwrap();
        assert_eq!(document.read_range(0, 10).unwrap(), b"abc");
    }

    #[test]
    fn empty_edit_is_not_recorded() {
        let file = temp_file(b"ab");
        let mut document = Document::open(1, file.path()).unwrap();

        document.edit(1, 0, b"", false).unwrap();
        assert!(!document.info().can_undo);
    }

    #[test]
    fn store_ids_are_unique_and_not_reused() {
        let store = DocumentStore::default();
        let file_a = temp_file(b"a");
        let file_b = temp_file(b"b");

        let a = store
            .insert(Document::open(store.next_id(), file_a.path()).unwrap())
            .unwrap();
        store.close(a.id).unwrap();
        let b = store
            .insert(Document::open(store.next_id(), file_b.path()).unwrap())
            .unwrap();

        assert_ne!(a.id, b.id);
    }

    #[test]
    fn store_returns_existing_document_for_same_file() {
        let store = DocumentStore::default();
        let file = temp_file(b"abc");

        let first = store
            .insert(Document::open(store.next_id(), file.path()).unwrap())
            .unwrap();
        let second = store
            .insert(Document::open(store.next_id(), file.path()).unwrap())
            .unwrap();

        assert_eq!(first, second);
        assert_eq!(store.list().unwrap().len(), 1);
    }

    #[test]
    fn store_close_removes_document() {
        let store = DocumentStore::default();
        let file_a = temp_file(b"a");
        let file_b = temp_file(b"b");

        let a = store
            .insert(Document::open(store.next_id(), file_a.path()).unwrap())
            .unwrap();
        let b = store
            .insert(Document::open(store.next_id(), file_b.path()).unwrap())
            .unwrap();

        store.close(a.id).unwrap();

        assert!(store.get(a.id).is_err());
        assert!(store.close(a.id).is_err());
        assert_eq!(store.list().unwrap(), vec![b.clone()]);
        assert!(store.get(b.id).is_ok());
    }
}
