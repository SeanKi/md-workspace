//! WebDAV 요청을 대신 보낸다 (동기화 — `packages/sync-core`).
//!
//! 왜 Rust 를 거치나: 웹뷰에서 `fetch` 로 Koofr 같은 남의 서버를 부르면 **CORS** 에 막힌다
//! (웹뷰의 출처는 `tauri://localhost`). 여기서 보내면 그런 제약이 없다.
//!
//! 비밀번호는 프론트엔드로 돌려주지 않는다. 계정 이름(`account`)만 받아 이 안에서 꺼내 쓴다
//! (`cred.rs`). 그래서 화면 코드·기록(`.mdlog`)에 비밀번호가 남을 길이 없다.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::time::Duration;

#[derive(Deserialize)]
pub struct DavRequest {
    pub method: String,
    pub url: String,
    /// 비밀번호를 찾을 계정 이름 (`cred_set` 으로 넣어 둔 것). 없으면 인증 없이
    pub account: Option<String>,
    pub user: Option<String>,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    /// 글 본문
    pub body: Option<String>,
    /// 바이너리 본문 (그림 등) — base64
    pub body_b64: Option<String>,
    /// 응답을 base64 로 돌려받을지
    #[serde(default)]
    pub binary: bool,
}

#[derive(Serialize)]
pub struct DavResponse {
    pub status: u16,
    /// 이름은 소문자로
    pub headers: BTreeMap<String, String>,
    pub body: String,
}

/// 글(문서 · 목록)은 1분이면 충분하다. 그림은 크다 — 폰으로 찍은 사진을 붙이면 20MB 가 넘는다.
/// 1분으로 묶어 두었더니 22MB 그림이 올리기·받기 모두 시간 초과로 다음 동기화로 밀렸다
fn agent(big: bool) -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(15))
        .timeout(Duration::from_secs(if big { 600 } else { 60 }))
        .build()
}

fn basic(user: &str, pass: &str) -> String {
    format!("Basic {}", STANDARD.encode(format!("{user}:{pass}")))
}

/// 요청 하나. 4xx·5xx 도 **오류가 아니라 응답**으로 돌려준다 — 412(조건 불일치)·404 는
/// 동기화가 판단에 쓰는 정상적인 답이다. 네트워크가 끊긴 것만 오류다.
#[tauri::command(async)]
pub fn dav_request(req: DavRequest) -> Result<DavResponse, String> {
    let big = req.binary || req.body_b64.is_some();
    let mut r = agent(big).request(&req.method, &req.url);
    if let (Some(account), Some(user)) = (req.account.as_deref(), req.user.as_deref()) {
        let pass = crate::cred::get(account)?.ok_or("저장된 비밀번호가 없습니다 — 설정에서 다시 넣어 주세요")?;
        r = r.set("Authorization", &basic(user, &pass));
    }
    for (k, v) in &req.headers {
        r = r.set(k, v);
    }
    let sent = if let Some(b64) = &req.body_b64 {
        let bytes = STANDARD.decode(b64).map_err(|e| e.to_string())?;
        r.send_bytes(&bytes)
    } else if let Some(text) = &req.body {
        r.send_string(text)
    } else {
        r.call()
    };
    let resp = match sent {
        Ok(resp) => resp,
        Err(ureq::Error::Status(_, resp)) => resp,
        Err(ureq::Error::Transport(t)) => return Err(format!("연결 실패: {t}")),
    };
    let status = resp.status();
    let mut headers = BTreeMap::new();
    for name in resp.headers_names() {
        if let Some(v) = resp.header(&name) {
            headers.insert(name.to_lowercase(), v.to_string());
        }
    }
    let body = if req.binary {
        let mut buf = Vec::new();
        std::io::Read::read_to_end(&mut resp.into_reader(), &mut buf).map_err(|e| e.to_string())?;
        STANDARD.encode(buf)
    } else {
        resp.into_string().map_err(|e| e.to_string())?
    };
    Ok(DavResponse { status, headers, body })
}
