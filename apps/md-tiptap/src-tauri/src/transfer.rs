//! PC → 폰으로 저장소 설정 넘기기 — QR 하나.
//!
//! 폰에서 WebDAV 주소 · 이메일 · 앱 비밀번호(길고 무작위)를 치는 것이 가장 큰 불편이었다.
//! PC 가 원격이 붙은 저장소의 주소 · 사용자 · **저장해 둔 비밀번호**를 QR 로 그리고, 폰이 카메라로 읽는다
//! (`sync/QrTransfer.jsx`). 비밀번호를 담으므로 QR 은 **여기(Rust)에서 SVG 로 그려** 넘긴다 —
//! 화면 코드(JS)에는 비밀번호가 글자로 오지 않는다.
//!
//! 담는 것: `MDNP1:` + JSON `{"r":[[이름, 주소, 사용자], …], "p":{"사용자@서버": 비밀번호}}`

use serde::Deserialize;
use std::collections::BTreeMap;

pub const PREFIX: &str = "MDNP1:";

#[derive(Deserialize)]
pub struct RepoRef {
    pub name: String,
    pub remote: String,
    pub user: String,
}

/// 비밀번호를 찾는 열쇠 — JS 의 `accountOf` (sync/adapter.js) 와 같아야 한다: `사용자@호스트`
fn account_of(remote: &str, user: &str) -> String {
    let host = remote
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(remote)
        .split('/')
        .next()
        .unwrap_or(remote);
    format!("{user}@{host}")
}

fn payload(repos: &[RepoRef], get: impl Fn(&str) -> Option<String>) -> String {
    let r: Vec<[&str; 3]> = repos.iter().map(|x| [x.name.as_str(), x.remote.as_str(), x.user.as_str()]).collect();
    let mut p = BTreeMap::new();
    for x in repos {
        let acc = account_of(&x.remote, &x.user);
        if let Some(pass) = get(&acc) {
            p.insert(acc, pass);
        }
    }
    format!("{PREFIX}{}", serde_json::json!({ "r": r, "p": p }))
}

/// 넘길 QR (SVG). 원격이 붙은 저장소만 받는다
#[tauri::command(async)]
pub fn transfer_qr(repos: Vec<RepoRef>) -> Result<String, String> {
    if repos.is_empty() {
        return Err("원격(WebDAV)이 붙은 저장소가 없습니다".into());
    }
    let text = payload(&repos, |acc| md_core::cred::get(acc).ok().flatten());
    let code = qrcode::QrCode::with_error_correction_level(text.as_bytes(), qrcode::EcLevel::L)
        .map_err(|e| format!("QR 을 만들지 못했습니다 (저장소가 너무 많을 수 있습니다): {e}"))?;
    Ok(code
        .render::<qrcode::render::svg::Color>()
        .min_dimensions(320, 320)
        .quiet_zone(true)
        .build())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 담는_것() {
        let repos = vec![
            RepoRef { name: "tasks".into(), remote: "https://app.koofr.net/dav/Koofr/mdfiles/tasks".into(), user: "a@b.c".into() },
            RepoRef { name: "docs".into(), remote: "https://app.koofr.net/dav/Koofr/mdfiles/docs".into(), user: "a@b.c".into() },
        ];
        let s = payload(&repos, |acc| (acc == "a@b.c@app.koofr.net").then(|| "pw".to_string()));
        assert!(s.starts_with(PREFIX));
        let v: serde_json::Value = serde_json::from_str(&s[PREFIX.len()..]).unwrap();
        assert_eq!(v["r"][0][0], "tasks");
        assert_eq!(v["p"]["a@b.c@app.koofr.net"], "pw");
        assert_eq!(v["p"].as_object().unwrap().len(), 1);   // 같은 계정은 한 번만
    }
}
