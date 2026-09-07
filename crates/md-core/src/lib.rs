//! MD Editor / MDSyncNote 공용 Tauri 커맨드.
//!
//! 앱 쪽에서는 이렇게 등록한다.
//!
//! ```ignore
//! tauri::generate_handler![
//!     md_core::commands::read_file,
//!     md_core::commands::write_file,
//!     md_core::commands::save_binary_b64,
//!     md_core::commands::read_binary_base64,
//!     md_core::commands::read_dir,
//!     md_core::pdf::save_pdf,
//!     md_core::search::search_repo,
//!     md_core::watcher::watch_file,
//!     md_core::watcher::unwatch_file,
//! ]
//! ```

pub mod commands;
pub mod diag;
pub mod pdf;
pub mod search;
pub mod watcher;
