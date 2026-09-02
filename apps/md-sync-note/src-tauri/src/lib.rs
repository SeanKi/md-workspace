mod git;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            md_core::commands::read_file,
            md_core::commands::write_file,
            md_core::commands::save_binary_b64,
            md_core::commands::read_binary_base64,
            md_core::commands::read_dir,
            md_core::commands::create_dir,
            md_core::commands::create_file,
            md_core::commands::rename_path,
            md_core::commands::delete_path,
            git::git_status,
            git::git_init,
            git::git_commit,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
