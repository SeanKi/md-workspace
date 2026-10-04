//! 동기화 서버 비밀번호를 보관한다.
//!
//! - Windows: **자격 증명 관리자** (`keyring`). 설정 파일(INI)에는 절대 쓰지 않는다 —
//!   INI 는 사람이 메모장으로 열고 다른 PC 로 옮기는 파일이다
//! - 폰: OS 키 저장소를 아직 잇지 않았다. 앱만 읽을 수 있는 앱 데이터 폴더의 파일에 둔다
//!   (`set_store_dir`). Android Keystore 로 옮기는 것은 다음 일이다
//!
//! 프론트엔드에는 "있는가" 만 알려 주고 값은 돌려주지 않는다 (`dav.rs` 가 직접 꺼내 쓴다).

const SERVICE: &str = "MD Tiptap sync";

#[cfg(windows)]
mod store {
    use super::SERVICE;
    fn entry(account: &str) -> Result<keyring::Entry, String> {
        keyring::Entry::new(SERVICE, account).map_err(|e| e.to_string())
    }
    pub fn set(account: &str, pass: &str) -> Result<(), String> {
        entry(account)?.set_password(pass).map_err(|e| e.to_string())
    }
    pub fn get(account: &str) -> Result<Option<String>, String> {
        match entry(account)?.get_password() {
            Ok(p) => Ok(Some(p)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }
    pub fn delete(account: &str) -> Result<(), String> {
        match entry(account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

#[cfg(not(windows))]
mod store {
    use std::collections::BTreeMap;
    use std::path::PathBuf;
    use std::sync::OnceLock;

    static DIR: OnceLock<PathBuf> = OnceLock::new();
    pub fn set_dir(dir: PathBuf) {
        let _ = DIR.set(dir);
    }
    fn file() -> Result<PathBuf, String> {
        Ok(DIR.get().ok_or("비밀번호 보관 폴더가 정해지지 않았습니다")?.join("sync-cred.json"))
    }
    fn load() -> BTreeMap<String, String> {
        file().ok()
            .and_then(|f| std::fs::read_to_string(f).ok())
            .and_then(|t| serde_json_lite(&t))
            .unwrap_or_default()
    }
    fn save(m: &BTreeMap<String, String>) -> Result<(), String> {
        let body: Vec<String> = m.iter().map(|(k, v)| format!("{}\t{}", k, v)).collect();
        std::fs::write(file()?, body.join("\n")).map_err(|e| e.to_string())
    }
    // 의존성을 늘리지 않으려고 탭으로 나눈 줄 형식을 쓴다 (계정\t비밀번호)
    fn serde_json_lite(t: &str) -> Option<BTreeMap<String, String>> {
        Some(t.lines().filter_map(|l| l.split_once('\t')).map(|(a, b)| (a.to_string(), b.to_string())).collect())
    }
    pub fn set(account: &str, pass: &str) -> Result<(), String> {
        let mut m = load();
        m.insert(account.to_string(), pass.to_string());
        save(&m)
    }
    pub fn get(account: &str) -> Result<Option<String>, String> {
        Ok(load().get(account).cloned())
    }
    pub fn delete(account: &str) -> Result<(), String> {
        let mut m = load();
        m.remove(account);
        save(&m)
    }
}

/// 폰: 비밀번호 파일을 둘 앱 데이터 폴더
#[cfg(not(windows))]
pub use store::set_dir as set_store_dir;

pub fn get(account: &str) -> Result<Option<String>, String> {
    store::get(account)
}

#[tauri::command(async)]
pub fn cred_set(account: String, password: String) -> Result<(), String> {
    store::set(&account, &password)
}

#[tauri::command(async)]
pub fn cred_has(account: String) -> Result<bool, String> {
    Ok(store::get(&account)?.is_some())
}

#[tauri::command(async)]
pub fn cred_delete(account: String) -> Result<(), String> {
    store::delete(&account)
}
