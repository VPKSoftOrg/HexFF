//! The list of recently opened files, kept in its own file next to the settings.
//!
//! It is separate from the settings so that saving the preferences, which writes the whole
//! settings object, never overwrites it.

use directories::ProjectDirs;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// The most files the list keeps.
pub const MAX_RECENT_FILES: usize = 10;

/// A recently opened file, as sent to the frontend.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct RecentFile {
    /// The path as the file was opened.
    pub path: String,
    /// The file name without the directory.
    pub name: String,
    /// Whether the file exists now.
    pub exists: bool,
}

/// The recently opened files, most recent first.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct RecentFiles {
    paths: Vec<String>,
}

/// Whether two paths refer to the same file, also when they are written differently
/// (e.g. different letter case on Windows, or `..` segments).
fn same_file(a: &str, b: &str) -> bool {
    if a == b {
        return true;
    }
    match (Path::new(a).canonicalize(), Path::new(b).canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

impl RecentFiles {
    /// Moves `path` to the top of the list, adding it if needed, and drops the oldest entries
    /// beyond [`MAX_RECENT_FILES`].
    pub fn add(&mut self, path: &str) {
        self.paths.retain(|existing| !same_file(existing, path));
        self.paths.insert(0, path.to_string());
        self.paths.truncate(MAX_RECENT_FILES);
    }

    /// Removes `path` from the list.
    pub fn remove(&mut self, path: &str) {
        self.paths.retain(|existing| !same_file(existing, path));
    }

    /// Removes every entry.
    pub fn clear(&mut self) {
        self.paths.clear();
    }

    /// The entries, most recent first.
    pub fn entries(&self) -> Vec<RecentFile> {
        self.paths
            .iter()
            .map(|path| {
                let file_path = Path::new(path);
                RecentFile {
                    path: path.clone(),
                    name: file_path
                        .file_name()
                        .map(|name| name.to_string_lossy().into_owned())
                        .unwrap_or_else(|| path.clone()),
                    exists: file_path.is_file(),
                }
            })
            .collect()
    }

    /// Loads the list from `file`. A missing or unreadable file gives an empty list.
    pub fn load(file: &Path) -> Self {
        fs::read_to_string(file)
            .ok()
            .and_then(|text| serde_json::from_str::<Self>(&text).ok())
            .map(|mut list| {
                list.paths.truncate(MAX_RECENT_FILES);
                list
            })
            .unwrap_or_default()
    }

    /// Saves the list to `file`, creating its directory if needed.
    pub fn save(&self, file: &Path) -> io::Result<()> {
        if let Some(directory) = file.parent() {
            fs::create_dir_all(directory)?;
        }
        let text = serde_json::to_string_pretty(self).map_err(io::Error::other)?;
        fs::write(file, text)
    }
}

/// The file the list is stored in, next to the settings file.
pub fn recent_files_path() -> Option<PathBuf> {
    ProjectDirs::from("rs", "", "hex_ff").map(|dirs| dirs.config_dir().join("recent-files.json"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn add_puts_newest_first_without_duplicates() {
        let mut list = RecentFiles::default();
        list.add("a.bin");
        list.add("b.bin");
        list.add("a.bin");

        let paths: Vec<String> = list.entries().into_iter().map(|e| e.path).collect();
        assert_eq!(paths, vec!["a.bin", "b.bin"]);
    }

    #[test]
    fn list_is_limited() {
        let mut list = RecentFiles::default();
        for i in 0..MAX_RECENT_FILES + 5 {
            list.add(&format!("file{i}.bin"));
        }

        let entries = list.entries();
        assert_eq!(entries.len(), MAX_RECENT_FILES);
        assert_eq!(entries[0].path, format!("file{}.bin", MAX_RECENT_FILES + 4));
    }

    #[test]
    fn same_file_written_differently_is_one_entry() {
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("data.bin");
        fs::write(&file, b"x").unwrap();
        let other_spelling = directory.path().join(".").join("data.bin");

        let mut list = RecentFiles::default();
        list.add(&file.to_string_lossy());
        list.add(&other_spelling.to_string_lossy());

        let entries = list.entries();
        assert_eq!(entries.len(), 1);
        assert!(entries[0].exists);
        assert_eq!(entries[0].name, "data.bin");
    }

    #[test]
    fn remove_and_clear() {
        let mut list = RecentFiles::default();
        list.add("a.bin");
        list.add("b.bin");

        list.remove("a.bin");
        assert_eq!(list.entries().len(), 1);

        list.clear();
        assert!(list.entries().is_empty());
    }

    #[test]
    fn missing_files_are_kept_and_marked() {
        let mut list = RecentFiles::default();
        list.add("does-not-exist.bin");

        assert!(!list.entries()[0].exists);
    }

    #[test]
    fn save_and_load_round_trip() {
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("nested").join("recent-files.json");
        let mut list = RecentFiles::default();
        list.add("a.bin");
        list.add("b.bin");

        list.save(&file).unwrap();

        assert_eq!(RecentFiles::load(&file), list);
    }

    #[test]
    fn missing_or_invalid_file_loads_empty() {
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("recent-files.json");
        assert_eq!(RecentFiles::load(&file), RecentFiles::default());

        fs::write(&file, "not json").unwrap();
        assert_eq!(RecentFiles::load(&file), RecentFiles::default());
    }
}
