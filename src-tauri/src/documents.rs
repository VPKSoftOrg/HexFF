use crate::history::{Change, History};
use crate::piece_table::PieceTable;
use serde::Serialize;
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::SystemTime;

/// A document identifier. Identifiers are never reused within an application run.
pub type DocumentId = u64;

/// The largest range a single `read_range` call may return.
pub const MAX_READ_LENGTH: usize = 16 * 1024 * 1024;

/// The largest number of bytes a single edit may insert.
pub const MAX_EDIT_LENGTH: usize = 16 * 1024 * 1024;

/// The size of the chunks written when saving.
const SAVE_CHUNK_LENGTH: usize = 1024 * 1024;

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
    /// Increases whenever the content is replaced from disk (after saving or reloading),
    /// so views know to read it again.
    pub generation: u64,
}

/// The size and modification time of a file, used to notice changes made by other programs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct FileStamp {
    len: u64,
    modified: Option<SystemTime>,
}

impl FileStamp {
    fn read(path: &Path) -> io::Result<Self> {
        Ok(Self::from_metadata(&fs::metadata(path)?))
    }

    fn from_metadata(metadata: &fs::Metadata) -> Self {
        Self {
            len: metadata.len(),
            modified: metadata.modified().ok(),
        }
    }
}

/// The result of saving a document.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SaveResult {
    /// The document was saved (or had nothing to save).
    Saved,
    /// Nothing was written because another program changed or replaced the file; saving with
    /// `force` overwrites it.
    ChangedOnDisk,
    /// Nothing was written because another program rewrote the open file in place. The unedited
    /// parts of the document are read from that file, so the document's version no longer
    /// exists and can't be saved; the file has to be reloaded.
    ChangedInPlace,
}

/// An open file and its unsaved edits.
///
/// The file on disk is opened read-only and is not changed by edits; the edits live in a
/// [`PieceTable`] on top of it.
pub struct Document {
    id: DocumentId,
    path: PathBuf,
    canonical_path: PathBuf,
    /// The open file. It is `None` only briefly while saving replaces the file.
    file: Option<File>,
    table: PieceTable,
    history: History,
    /// The file's size and modification time when it was last opened, saved or reloaded.
    stamp: FileStamp,
    generation: u64,
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
        let stamp = FileStamp::read(&canonical_path)?;

        Ok(Self {
            id,
            path: path.to_path_buf(),
            canonical_path,
            file: Some(file),
            table: PieceTable::new(metadata.len()),
            history: History::default(),
            stamp,
            generation: 0,
        })
    }

    /// The canonical path of the file.
    pub fn canonical_path(&self) -> &Path {
        &self.canonical_path
    }

    /// Whether the file on disk was changed, replaced or removed by another program since it was
    /// last opened, saved or reloaded.
    pub fn changed_on_disk(&self) -> bool {
        FileStamp::read(&self.canonical_path).map_or(true, |stamp| stamp != self.stamp)
    }

    /// Whether the open file still has the content it had when it was opened, saved or reloaded.
    ///
    /// This is checked through the open handle: a file that another program replaced (e.g. saved
    /// by renaming a new file over it) keeps its old content behind the handle, but a file rewritten
    /// in place does not.
    fn original_intact(&self) -> bool {
        match &self.file {
            Some(file) => file
                .metadata()
                .is_ok_and(|metadata| FileStamp::from_metadata(&metadata) == self.stamp),
            None => true,
        }
    }

    /// Saves the edited content to the file it was opened from.
    ///
    /// An unmodified document is not written. Unless `force` is set, nothing is written when another
    /// program changed the file. A file rewritten in place is never overwritten, because the document's
    /// version can no longer be read completely.
    pub fn save(&mut self, force: bool) -> io::Result<SaveResult> {
        if !force && !self.history.is_modified() {
            return Ok(SaveResult::Saved);
        }
        if !self.original_intact() {
            return Ok(SaveResult::ChangedInPlace);
        }
        if !force && self.changed_on_disk() {
            return Ok(SaveResult::ChangedOnDisk);
        }
        let target = self.canonical_path.clone();
        self.write_to(&target)?;
        Ok(SaveResult::Saved)
    }

    /// Saves the edited content to `path`; the document then refers to the new file.
    ///
    /// Like [`Document::save`], nothing is written when the open file was rewritten in place.
    pub fn save_as(&mut self, path: &Path) -> io::Result<SaveResult> {
        if !self.original_intact() {
            return Ok(SaveResult::ChangedInPlace);
        }
        self.write_to(path)?;
        self.path = path.to_path_buf();
        self.canonical_path = path.canonicalize()?;
        Ok(SaveResult::Saved)
    }

    /// Discards the edits and reads the file from disk again.
    pub fn reload(&mut self) -> io::Result<()> {
        self.reopen(&self.canonical_path.clone())
    }

    /// Writes the edited content to `target` safely and reopens the document from it.
    ///
    /// The content goes to a temporary file in the target's directory, which is flushed to disk
    /// and then renamed over the target, so the target is never left partly written. The edit
    /// history starts over afterwards, because the old history refers to the replaced file.
    fn write_to(&mut self, target: &Path) -> io::Result<()> {
        let directory = target
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
            .unwrap_or_else(|| Path::new("."));
        let mut temp = tempfile::Builder::new()
            .prefix(".hexff-")
            .suffix(".tmp")
            .tempfile_in(directory)?;

        let mut offset = 0u64;
        while offset < self.table.len() {
            let chunk = self.read_range(offset, SAVE_CHUNK_LENGTH)?;
            if chunk.is_empty() {
                return Err(io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    "the file ended before all content was read",
                ));
            }
            temp.write_all(&chunk)?;
            offset += chunk.len() as u64;
        }
        temp.as_file().sync_all()?;

        // Keep the permissions of the file being replaced (e.g. the executable bit).
        #[cfg(unix)]
        if let Ok(metadata) = fs::metadata(target) {
            fs::set_permissions(temp.path(), metadata.permissions())?;
        }

        // Windows can't replace a file that is open, so close it first when saving over it. The
        // new content is already complete in the temporary file, so the old file isn't needed.
        let replaces_own_file =
            target.canonicalize().ok().as_deref() == Some(&*self.canonical_path);
        if replaces_own_file {
            self.file = None;
        }

        match temp.persist(target) {
            Ok(_) => self.reopen(target),
            Err(error) => {
                // Keep the unsaved edits readable by opening the unchanged original again.
                if self.file.is_none() {
                    self.file = Some(File::open(&self.canonical_path)?);
                }
                Err(error.error)
            }
        }
    }

    /// Opens `path` as the document's file and drops the edits and their history.
    fn reopen(&mut self, path: &Path) -> io::Result<()> {
        let file = File::open(path)?;
        let len = file.metadata()?.len();
        self.stamp = FileStamp::read(path)?;
        self.file = Some(file);
        self.table = PieceTable::new(len);
        self.history = History::default();
        self.generation += 1;
        Ok(())
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
            generation: self.generation,
        }
    }

    /// Reads up to `length` bytes of the edited content starting from `offset`.
    ///
    /// The result is shorter than `length` when the range extends past the end,
    /// and empty when `offset` is at or past the end.
    pub fn read_range(&mut self, offset: u64, length: usize) -> io::Result<Vec<u8>> {
        let Some(file) = self.file.as_mut() else {
            return Err(io::Error::other("the file is being saved"));
        };
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
    pub fn update_info(&self, info: &DocumentInfo, canonical_path: &Path) -> Result<(), String> {
        if let Some(entry) = self.lock_documents()?.get_mut(&info.id) {
            entry.info = info.clone();
            entry.canonical_path = canonical_path.to_path_buf();
        }
        Ok(())
    }

    /// Whether `path` is open in a document other than `id`.
    pub fn is_open_elsewhere(&self, id: DocumentId, path: &Path) -> Result<bool, String> {
        let Ok(canonical_path) = path.canonicalize() else {
            // A file that doesn't exist yet can't be open.
            return Ok(false);
        };
        Ok(self
            .lock_documents()?
            .iter()
            .any(|(entry_id, entry)| *entry_id != id && entry.canonical_path == canonical_path))
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
    fn save_writes_edits_over_the_open_file() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("data.bin");
        fs::write(&path, b"0123456789").unwrap();
        let mut document = Document::open(1, &path).unwrap();

        document.edit(2, 3, b"ab", false).unwrap();
        document.edit(0, 0, b">>", false).unwrap();
        assert_eq!(document.save(false).unwrap(), SaveResult::Saved);

        assert_eq!(fs::read(&path).unwrap(), b">>01ab56789");
        let info = document.info();
        assert!(!info.modified);
        assert!(!info.can_undo);
        assert_eq!(info.generation, 1);
        assert_eq!(document.read_range(0, 100).unwrap(), b">>01ab56789");
        // The temporary file was renamed over the target, so only the target is left.
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn edits_continue_to_work_after_saving() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("data.bin");
        fs::write(&path, b"abc").unwrap();
        let mut document = Document::open(1, &path).unwrap();

        document.edit(3, 0, b"d", false).unwrap();
        document.save(false).unwrap();
        document.edit(0, 1, b"A", false).unwrap();
        document.save(false).unwrap();

        assert_eq!(fs::read(&path).unwrap(), b"Abcd");
    }

    #[test]
    fn saving_an_unmodified_document_does_not_write() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("data.bin");
        fs::write(&path, b"abc").unwrap();
        let mut document = Document::open(1, &path).unwrap();

        assert_eq!(document.save(false).unwrap(), SaveResult::Saved);
        assert_eq!(document.info().generation, 0);
    }

    #[test]
    fn file_rewritten_in_place_is_never_overwritten() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("data.bin");
        let copy = directory.path().join("copy.bin");
        fs::write(&path, b"abc").unwrap();
        let mut document = Document::open(1, &path).unwrap();
        document.edit(0, 1, b"X", false).unwrap();

        // Another program rewrites the open file in place (a different length is detected even
        // if the modification time has a coarse resolution).
        fs::write(&path, b"changed elsewhere").unwrap();

        assert!(document.changed_on_disk());
        assert_eq!(document.save(false).unwrap(), SaveResult::ChangedInPlace);
        assert_eq!(document.save(true).unwrap(), SaveResult::ChangedInPlace);
        assert_eq!(document.save_as(&copy).unwrap(), SaveResult::ChangedInPlace);
        assert_eq!(fs::read(&path).unwrap(), b"changed elsewhere");
        assert!(!copy.exists());

        // Reloading shows the new content and makes saving possible again.
        document.reload().unwrap();
        document.edit(0, 1, b"C", false).unwrap();
        assert_eq!(document.save(false).unwrap(), SaveResult::Saved);
        assert_eq!(fs::read(&path).unwrap(), b"Changed elsewhere");
    }

    /// Renaming over an open file isn't possible on Windows, so this case only exists elsewhere.
    #[cfg(unix)]
    #[test]
    fn replaced_file_is_overwritten_only_when_forced() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("data.bin");
        let replacement = directory.path().join("replacement.bin");
        fs::write(&path, b"abc").unwrap();
        let mut document = Document::open(1, &path).unwrap();
        document.edit(0, 1, b"X", false).unwrap();

        // Another program saves by renaming a new file over it; the open handle keeps the old content.
        fs::write(&replacement, b"replaced by another program").unwrap();
        fs::rename(&replacement, &path).unwrap();

        assert_eq!(document.save(false).unwrap(), SaveResult::ChangedOnDisk);
        assert_eq!(fs::read(&path).unwrap(), b"replaced by another program");

        assert_eq!(document.save(true).unwrap(), SaveResult::Saved);
        assert_eq!(fs::read(&path).unwrap(), b"Xbc");
        assert!(!document.changed_on_disk());
    }

    #[test]
    fn removed_file_counts_as_changed() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("data.bin");
        fs::write(&path, b"abc").unwrap();
        let document = Document::open(1, &path).unwrap();
        drop(document);
        let document = Document::open(1, &path).unwrap();

        fs::remove_file(&path).ok();

        // On Windows the open handle may keep the file from being removed; either way a
        // missing or unchanged file must not panic.
        assert_eq!(document.changed_on_disk(), !path.exists());
    }

    #[test]
    fn save_as_writes_a_new_file_and_switches_to_it() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("data.bin");
        let copy = directory.path().join("copy.bin");
        fs::write(&path, b"abc").unwrap();
        let mut document = Document::open(1, &path).unwrap();

        document.edit(1, 1, b"B", false).unwrap();
        document.save_as(&copy).unwrap();

        assert_eq!(fs::read(&copy).unwrap(), b"aBc");
        assert_eq!(fs::read(&path).unwrap(), b"abc");
        assert_eq!(document.info().name, "copy.bin");
        assert_eq!(document.canonical_path(), copy.canonicalize().unwrap());
        assert!(!document.info().modified);
    }

    #[test]
    fn reload_discards_edits_and_reads_the_disk() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("data.bin");
        fs::write(&path, b"abc").unwrap();
        let mut document = Document::open(1, &path).unwrap();
        document.edit(0, 1, b"X", false).unwrap();
        fs::write(&path, b"new content").unwrap();

        document.reload().unwrap();

        assert_eq!(document.read_range(0, 100).unwrap(), b"new content");
        assert!(!document.info().modified);
        assert!(!document.changed_on_disk());
        assert_eq!(document.info().generation, 1);
    }

    #[test]
    fn saving_a_large_document_writes_every_chunk() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("large.bin");
        let original: Vec<u8> = (0..(SAVE_CHUNK_LENGTH * 2 + 123))
            .map(|i| (i % 251) as u8)
            .collect();
        fs::write(&path, &original).unwrap();
        let mut document = Document::open(1, &path).unwrap();

        document
            .edit(SAVE_CHUNK_LENGTH as u64, 0, b"MIDDLE", false)
            .unwrap();
        document.save(false).unwrap();

        let mut expected = original.clone();
        expected.splice(SAVE_CHUNK_LENGTH..SAVE_CHUNK_LENGTH, *b"MIDDLE");
        assert_eq!(fs::read(&path).unwrap(), expected);
    }

    #[test]
    fn store_reports_files_open_elsewhere() {
        let store = DocumentStore::default();
        let file_a = temp_file(b"a");
        let file_b = temp_file(b"b");
        let a = store
            .insert(Document::open(store.next_id(), file_a.path()).unwrap())
            .unwrap();
        let b = store
            .insert(Document::open(store.next_id(), file_b.path()).unwrap())
            .unwrap();

        assert!(store.is_open_elsewhere(a.id, file_b.path()).unwrap());
        assert!(!store.is_open_elsewhere(b.id, file_b.path()).unwrap());
        assert!(!store
            .is_open_elsewhere(a.id, Path::new("does-not-exist.bin"))
            .unwrap());
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
