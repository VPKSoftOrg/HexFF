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

/// Information about an open document, sent to the frontend.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct DocumentInfo {
    /// The document identifier.
    pub id: DocumentId,
    /// The full path of the file as it was opened.
    pub path: String,
    /// The file name without the directory.
    pub name: String,
    /// The file size in bytes.
    pub size: u64,
}

/// An open file.
pub struct Document {
    id: DocumentId,
    path: PathBuf,
    canonical_path: PathBuf,
    file: File,
    size: u64,
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
            size: metadata.len(),
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
            size: self.size,
        }
    }

    /// Reads up to `length` bytes starting from `offset`.
    ///
    /// The result is shorter than `length` when the range extends past the end of the file,
    /// and empty when `offset` is at or past the end of the file.
    pub fn read_range(&mut self, offset: u64, length: usize) -> io::Result<Vec<u8>> {
        if offset >= self.size || length == 0 {
            return Ok(Vec::new());
        }

        let available = usize::try_from(self.size - offset).unwrap_or(usize::MAX);
        let length = length.min(available);
        let mut buffer = Vec::with_capacity(length);

        self.file.seek(SeekFrom::Start(offset))?;
        (&mut self.file)
            .take(length as u64)
            .read_to_end(&mut buffer)?;

        Ok(buffer)
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
        assert_eq!(
            info.name,
            file.path().file_name().unwrap().to_string_lossy()
        );
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
