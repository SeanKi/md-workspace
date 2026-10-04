//! Tiptap 시험판. 파일 I/O 는 두 앱과 같은 `md-core` 커맨드를 그대로 쓴다.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            md_core::commands::read_file,
            md_core::commands::write_file,
            md_core::commands::save_binary_b64,
            md_core::commands::read_binary_base64,
            md_core::commands::open_external,
            md_core::diag::log_write,
            md_core::diag::log_dir,
            md_core::diag::log_tail,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
