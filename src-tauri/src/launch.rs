//! Files the operating system asks the application to open: command-line arguments (which also
//! covers "Open with"), arguments of a second launch passed on by the single-instance plugin, and
//! macOS "open file" events.
//!
//! The paths are queued and the frontend is told with the [`OPEN_FILES_EVENT`] event; it then takes
//! them with the `take_pending_open_files` command. Queueing also covers files given at startup,
//! before the frontend is listening.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// The event that tells the frontend there are files to open.
pub const OPEN_FILES_EVENT: &str = "open-files-requested";

/// Files waiting to be opened by the frontend.
#[derive(Default)]
pub struct PendingOpens(Mutex<Vec<String>>);

impl PendingOpens {
    /// Creates the queue with the files given on the command line.
    pub fn from_args(args: impl IntoIterator<Item = OsString>, cwd: &Path) -> Self {
        Self(Mutex::new(file_args(args, cwd)))
    }

    /// Takes the queued paths, leaving the queue empty.
    pub fn take(&self) -> Vec<String> {
        self.0
            .lock()
            .map(|mut paths| std::mem::take(&mut *paths))
            .unwrap_or_default()
    }

    fn push(&self, paths: Vec<String>) {
        if let Ok(mut pending) = self.0.lock() {
            pending.extend(paths);
        }
    }
}

/// Picks the existing files from launch arguments. Relative paths are resolved against `cwd`;
/// options and anything that isn't a file are skipped.
pub fn file_args(args: impl IntoIterator<Item = OsString>, cwd: &Path) -> Vec<String> {
    args.into_iter()
        .map(PathBuf::from)
        .filter(|path| !path.to_string_lossy().starts_with('-'))
        .map(|path| {
            if path.is_relative() {
                cwd.join(path)
            } else {
                path
            }
        })
        .filter(|path| path.is_file())
        .map(|path| path.to_string_lossy().into_owned())
        .collect()
}

/// Queues files to open and tells the frontend. Brings the main window to the front, since the
/// request usually comes from another program or a second launch.
pub fn request_open<R: Runtime>(app: &AppHandle<R>, paths: Vec<String>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    if paths.is_empty() {
        return;
    }
    app.state::<PendingOpens>().push(paths);
    let _ = app.emit(OPEN_FILES_EVENT, ());
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn file_args_keeps_existing_files_and_resolves_relative_paths() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("a.bin"), b"a").unwrap();
        let absolute = directory.path().join("b.bin");
        fs::write(&absolute, b"b").unwrap();
        fs::create_dir(directory.path().join("folder")).unwrap();

        let args = [
            "a.bin",
            absolute.to_str().unwrap(),
            "--flag",
            "missing.bin",
            "folder",
        ]
        .map(OsString::from);

        assert_eq!(
            file_args(args, directory.path()),
            vec![
                directory
                    .path()
                    .join("a.bin")
                    .to_string_lossy()
                    .into_owned(),
                absolute.to_string_lossy().into_owned(),
            ]
        );
    }

    #[test]
    fn pending_opens_are_taken_once() {
        let pending = PendingOpens::default();
        pending.push(vec!["a.bin".into()]);
        pending.push(vec!["b.bin".into()]);

        assert_eq!(pending.take(), vec!["a.bin", "b.bin"]);
        assert!(pending.take().is_empty());
    }
}
