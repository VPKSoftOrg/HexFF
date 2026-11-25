use directories::ProjectDirs;
use serde_derive::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// The software settings.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AppConfig {
    /// The current application locale used by the i18next library
    locale: String,
    /// A value indicating whether the plugin-window-state should be used to remember the previous window state.
    save_window_state: bool,
    /// A value indicating whether to use dark mode with the application.
    dark_mode: bool,
    /// A value indicating whether a load error occurred.
    error: bool,
    /// An error message if one occurred.
    error_message: String,
}

// The default value for the application configuration.
impl ::std::default::Default for AppConfig {
    fn default() -> Self {
        Self {
            locale: "en".to_string(),
            save_window_state: false,
            error: false,
            error_message: "".to_string(),
            dark_mode: false,
        }
    }
}

/// Gets the settings file path.
///
/// confy 1.0+ resolves its default directory with a different strategy, which moves the file on macOS
/// (`~/Library/Application Support/rs.hex_ff` -> `~/.config/hex_ff`). Resolving the path here keeps the
/// location confy 0.6 used, so existing settings are still found.
///
/// # Returns
/// The settings file path, or `None` if the home directory can't be determined.
fn config_file_path() -> Option<PathBuf> {
    ProjectDirs::from("rs", "", "hex_ff").map(|dirs| dirs.config_dir().join("default-config.toml"))
}

/// Gets the application config from a file or default if one doesn't exist.
///
/// # Returns
/// An AppConfig value
pub fn get_app_config() -> AppConfig {
    match config_file_path() {
        Some(path) => load_from(&path),
        None => error_config("could not determine home directory path".to_string()),
    }
}

/// Saves the application config to a settings file using confy. The file format is TOML.
/// # Arguments
///
/// * `config` - the application configuration value.
///
/// # Returns
/// `true` if the config was successfully saved; `false` otherwise.
pub fn set_app_config(config: AppConfig) -> bool {
    match config_file_path() {
        Some(path) => store_to(&path, config),
        None => false,
    }
}

/// Loads the config from `path`. A missing file is created with the default values; a file that
/// can't be read gives the default values with `error` set.
fn load_from(path: &Path) -> AppConfig {
    confy::load_path(path).unwrap_or_else(|e| error_config(e.to_string()))
}

/// Stores the config to `path`. Returns `true` on success.
fn store_to(path: &Path, config: AppConfig) -> bool {
    confy::store_path(path, config).is_ok()
}

/// The default config marked with a load error.
fn error_config(error_message: String) -> AppConfig {
    AppConfig {
        error: true,
        error_message,
        ..AppConfig::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn missing_file_loads_defaults_and_creates_the_file() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config.toml");

        assert_eq!(load_from(&path), AppConfig::default());
        assert!(path.is_file());
    }

    #[test]
    fn stored_config_loads_back() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config.toml");
        let config = AppConfig {
            locale: "fi".to_string(),
            save_window_state: true,
            dark_mode: true,
            ..AppConfig::default()
        };

        assert!(store_to(&path, config.clone()));
        assert_eq!(load_from(&path), config);
    }

    #[test]
    fn invalid_file_loads_defaults_with_an_error() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config.toml");
        fs::write(&path, "this is = not [valid toml").unwrap();

        let config = load_from(&path);
        assert!(config.error);
        assert!(!config.error_message.is_empty());
        assert_eq!(config.locale, "en");
        assert!(!config.dark_mode);
    }

    #[test]
    fn storing_into_a_missing_directory_creates_it() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("nested").join("config.toml");

        assert!(store_to(&path, AppConfig::default()));
        assert!(path.is_file());
    }

    /// The field names are part of the contract with the `Settings` type in `Settings.ts`.
    #[test]
    fn serialized_field_names_match_the_frontend() {
        let value = serde_json::to_value(AppConfig::default()).unwrap();
        let mut keys: Vec<&str> = value
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            [
                "dark_mode",
                "error",
                "error_message",
                "locale",
                "save_window_state"
            ]
        );
    }
}
