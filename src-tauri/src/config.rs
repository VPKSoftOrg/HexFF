use directories::ProjectDirs;
use serde_derive::{Deserialize, Serialize};
use std::path::PathBuf;

/// The software settings.
#[derive(Debug, Serialize, Deserialize)]
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
    let loaded = match config_file_path() {
        Some(path) => confy::load_path(path),
        None => Err(confy::ConfyError::BadConfigDirectory(
            "could not determine home directory path".to_string(),
        )),
    };

    match loaded {
        Ok(v) => v,
        Err(e) => AppConfig {
            error_message: e.to_string(),
            error: true,
            locale: "en".to_string(),
            save_window_state: false,
            dark_mode: false,
        },
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
        Some(path) => confy::store_path(path, config).is_ok(),
        None => false,
    }
}
