use axum::{
    body::Body,
    extract::Query,
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use reqwest::header::{HeaderMap, ORIGIN, REFERER, USER_AGENT};
use serde::Deserialize;
use std::net::SocketAddr;
use std::sync::LazyLock;
use std::time::Duration;
use tokio::net::TcpListener;
use tower_http::cors::CorsLayer;

pub struct ProxyState {
    pub port: u16,
}

#[derive(Debug, Deserialize)]
pub struct StreamQuery {
    pub url: String,
    pub platform: Option<String>,
}

/// 全局共享的流媒体代理 HTTP 客户端：
/// - 严禁配置整体超时（.timeout 会强行切断长连接 HTTP-FLV 实时推流导致 Early-EOF）
/// - 配置 10 秒握手超时（connect_timeout）
/// - 配置 15 秒 TCP KeepAlive 保持连接活跃，防止 NAT 路由及防火墙静默断连
static PROXY_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .tcp_keepalive(Some(Duration::from_secs(15)))
        .build()
        .expect("Failed to initialize stream proxy reqwest client")
});

async fn handle_stream(Query(params): Query<StreamQuery>) -> Result<Response, (StatusCode, String)> {
    let target_url = params.url.trim();
    if !target_url.starts_with("http://") && !target_url.starts_with("https://") {
        return Err((StatusCode::BAD_REQUEST, "Invalid stream URL".to_string()));
    }

    let platform = params.platform.unwrap_or_else(|| "douyin".to_string());
    let is_bilibili = platform.eq_ignore_ascii_case("bilibili")
        || target_url.contains("bilibili.com")
        || target_url.contains("bilivideo.com");

    let mut headers = HeaderMap::new();
    headers.insert(
        USER_AGENT,
        HeaderValue::from_static(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 Edg/147.0.0.0",
        ),
    );

    if is_bilibili {
        headers.insert(
            REFERER,
            HeaderValue::from_static("https://live.bilibili.com/"),
        );
        headers.insert(
            ORIGIN,
            HeaderValue::from_static("https://live.bilibili.com"),
        );
    } else {
        headers.insert(
            REFERER,
            HeaderValue::from_static("https://live.douyin.com/"),
        );
    }

    let upstream_resp = PROXY_CLIENT
        .get(target_url)
        .headers(headers)
        .send()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, format!("Failed to reach upstream CDN: {}", e)))?;

    let status = upstream_resp.status();
    if !status.is_success() {
        return Err((
            StatusCode::BAD_GATEWAY,
            format!("Upstream returned status: {}", status),
        ));
    }

    let content_type = upstream_resp
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("video/x-flv")
        .to_string();

    let stream = upstream_resp.bytes_stream();
    let body = Body::from_stream(stream);

    let mut response = body.into_response();
    let resp_headers = response.headers_mut();

    if let Ok(ct) = HeaderValue::from_str(&content_type) {
        resp_headers.insert(header::CONTENT_TYPE, ct);
    }
    resp_headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
    resp_headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-cache, no-store, must-revalidate"),
    );

    Ok(response)
}

pub async fn start_stream_proxy() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind local proxy listener: {}", e))?;

    let local_addr = listener
        .local_addr()
        .map_err(|e| format!("Failed to get local address: {}", e))?;
    let port = local_addr.port();

    log::info!("[StreamProxy] Local streaming proxy listening on http://127.0.0.1:{}", port);

    let app = Router::new()
        .route("/stream", get(handle_stream))
        .layer(CorsLayer::permissive());

    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>()).await {
            log::error!("[StreamProxy] Server error: {}", e);
        }
    });

    Ok(port)
}
