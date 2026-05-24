use std::sync::LazyLock;
use std::time::Duration;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use url::form_urlencoded;

static RE_ID: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"live\.douyin\.com/([0-9a-zA-Z_]+)").unwrap());
static RE_CLEAN: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[0-9a-zA-Z_]+$").unwrap());
static RE_PACE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"self\.__pace_f\.push\(\[\s*\d+\s*,\s*"(.*?)"\s*\]\)"#).unwrap());
static RE_RENDER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"<script\s+id="RENDER_DATA"\s+type="application/json">([^<]+)</script>"#).unwrap());
static RE_TITLE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<title>([^<]+)</title>").unwrap());

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LiveStream {
    pub quality_name: String, // 例如: 原画, 蓝光, 超清, 高清
    pub flv_url: Option<String>,
    pub m3u8_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LiveRoomInfo {
    pub room_id: String,
    pub anchor_name: String,
    pub title: String,
    pub is_live: bool,
    pub streams: Vec<LiveStream>,
}

// 递归查找包含 room 和 stream_url 的子节点（可以指定是否必须包含 stream_url）
fn find_room_node(val: &Value, require_stream: bool) -> Option<&Value> {
    if let Some(obj) = val.as_object() {
        if obj.contains_key("room") {
            let room = obj.get("room").unwrap();
            if (!require_stream || room.get("stream_url").is_some()) && room.is_object() {
                return Some(val);
            }
        }
        for (_, child) in obj {
            if let Some(res) = find_room_node(child, require_stream) {
                return Some(res);
            }
        }
    } else if let Some(arr) = val.as_array() {
        for child in arr {
            if let Some(res) = find_room_node(child, require_stream) {
                return Some(res);
            }
        }
    }
    None
}

// 映射画质名称为友好中文名称
fn map_quality_name(key: &str) -> String {
    match key {
        "ORIGIN" => "原画".to_string(),
        "BLUE_LIGHT" | "BLUE" => "蓝光".to_string(),
        "FULL_HD1" | "FULL_HD" => "超清".to_string(),
        "HD1" | "HD" => "高清".to_string(),
        "SD1" | "SD" => "标清".to_string(),
        other => other.to_string(),
    }
}

pub async fn parse_douyin_live(
    room_url: &str,
    cookie: &str,
    user_agent: &str,
    sec_ch_ua: &str,
) -> Result<LiveRoomInfo, String> {
    // 兼容处理：如果输入的是纯 ID（仅包含数字、字母、下划线），则自动拼接为完整 URL
    // 否则，从 URL 中解析出 ID
    let (actual_url, room_id) = if room_url.contains("live.douyin.com/") {
        let id = RE_ID
            .captures(room_url)
            .and_then(|cap| cap.get(1))
            .map(|m| m.as_str().to_string())
            .ok_or_else(|| "无法从 URL 中解析出直播间 ID，请确认链接格式。".to_string())?;
        (room_url.to_string(), id)
    } else {
        let clean_id = room_url.trim().to_string();
        if clean_id.is_empty() {
            return Err("直播间链接或 ID 不能为空".to_string());
        }
        if RE_CLEAN.is_match(&clean_id) {
            (format!("https://live.douyin.com/{}", clean_id), clean_id)
        } else {
            return Err("输入格式不正确，请输入抖音直播间链接或合法的数字 ID。".to_string());
        }
    };

    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7".parse().unwrap());
    headers.insert("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6".parse().unwrap());
    headers.insert("Referer", "https://live.douyin.com/".parse().unwrap());

    // 优先采用配置的 UA 与 sec-ch-ua，若空则使用 Edge 147 的默认值
    let actual_ua = if user_agent.trim().is_empty() {
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 Edg/147.0.0.0"
    } else {
        user_agent
    };

    let actual_sec_ch_ua = if sec_ch_ua.trim().is_empty() {
        "\"Microsoft Edge\";v=\"147\", \"Not.A/Brand\";v=\"8\", \"Chromium\";v=\"147\""
    } else {
        sec_ch_ua
    };

    headers.insert("sec-ch-ua", actual_sec_ch_ua.parse().unwrap());
    headers.insert("sec-ch-ua-mobile", "?0".parse().unwrap());
    headers.insert("sec-ch-ua-platform", "\"Windows\"".parse().unwrap());
    headers.insert("sec-fetch-dest", "document".parse().unwrap());
    headers.insert("sec-fetch-mode", "navigate".parse().unwrap());
    headers.insert("sec-fetch-site", "same-origin".parse().unwrap());
    headers.insert("upgrade-insecure-requests", "1".parse().unwrap());

    let client = reqwest::Client::builder()
        .user_agent(actual_ua)
        .default_headers(headers)
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("构建HTTP客户端失败: {}", e))?;

    let mut request = client.get(&actual_url);
    if !cookie.trim().is_empty() {
        request = request.header("Cookie", cookie);
    }

    let response = request
        .send()
        .await
        .map_err(|e| format!("请求网页失败: {}", e))?;

    let html = response
        .text()
        .await
        .map_err(|e| format!("读取网页内容失败: {}", e))?;

    // 1. 优先尝试从最新的 self.__pace_f.push 数据中解析 (现代 Next.js 架构)
    let re_pace = &*RE_PACE;
    let mut room_info_found = None;
    let mut fallback_room_info = None;

    for caps in re_pace.captures_iter(&html) {
        if let Some(matched) = caps.get(1) {
            let raw_str = matched.as_str();
            // 过滤既无 stream_url 也无 "room" 键的数据以节省性能
            if !raw_str.contains("stream_url") && !raw_str.contains("\"room\"") {
                continue;
            }

            // 使用 serde_json 反序列化机制，完美还原 JSON 字符串转义
            let wrapped = format!("\"{}\"", raw_str);
            if let Ok(unescaped_str) = serde_json::from_str::<String>(&wrapped) {
                let start_bracket = unescaped_str.find('[');
                let start_brace = unescaped_str.find('{');
                let start = match (start_bracket, start_brace) {
                    (Some(b), Some(c)) => Some(b.min(c)),
                    (Some(b), None) => Some(b),
                    (None, Some(c)) => Some(c),
                    (None, None) => None,
                };

                if let Some(s) = start {
                    let json_candidate = &unescaped_str[s..];
                    if let Ok(val) = serde_json::from_str::<Value>(json_candidate) {
                        if let Some(room_node) = find_room_node(&val, true) {
                            room_info_found = Some(room_node.clone());
                            break;
                        } else if fallback_room_info.is_none() {
                            if let Some(room_node) = find_room_node(&val, false) {
                                fallback_room_info = Some(room_node.clone());
                            }
                        }
                    }
                }
            }
        }
    }

    // 2. 如果 pace 模式未匹配到，则回退到匹配传统的 RENDER_DATA 标签
    let room_node = if let Some(node) = room_info_found {
        node
    } else if let Some(node) = fallback_room_info {
        node
    } else {
        let re_render = &*RE_RENDER;
        if let Some(captures) = re_render.captures(&html) {
            let encoded_json = captures.get(1).unwrap().as_str();
            let decoded_bytes = form_urlencoded::parse(encoded_json.as_bytes())
                .map(|(key, _)| key.into_owned())
                .collect::<Vec<String>>()
                .join("");

            if let Ok(json_val) = serde_json::from_str::<Value>(&decoded_bytes) {
                if let Some(node) = find_room_node(&json_val, true) {
                    node.clone()
                } else if let Some(node) = find_room_node(&json_val, false) {
                    node.clone()
                } else {
                    return Err("在 RENDER_DATA 中未找到有效直播间数据".to_string());
                }
            } else {
                return Err("反序列化传统 RENDER_DATA 失败".to_string());
            }
        } else {
            // 风控及网页报错诊断落地 (写入到系统“下载”目录中，避免污染项目并彻底切断 Tauri 与 Vite 的热重载监视)
            let error_file_path = std::env::var("USERPROFILE")
                .map(|p| std::path::PathBuf::from(p).join("Downloads").join("douyin_error_page.html"))
                .unwrap_or_else(|_| std::env::temp_dir().join("douyin_error_page.html"));
            
            let write_status = std::fs::write(&error_file_path, &html)
                .map(|_| "已成功保存".to_string())
                .unwrap_or_else(|e| format!("保存失败: {}", e));

            let title = RE_TITLE.captures(&html)
                .and_then(|c| c.get(1))
                .map(|m| m.as_str().trim().to_string())
                .unwrap_or_else(|| "无标题/空白页".to_string());

            let has_captcha = html.contains("验证码") || html.contains("security") || html.contains("滑块") || html.contains("验证");

            return Err(format!(
                "未在页面中提取到直播间数据！\n\
                 - 网页标题: '{}'\n\
                 - 网页体积: {} 字节\n\
                 - 疑似触发滑块验证: {}\n\
                 - 诊断文件保存: {}\n\n\
                 可能原因：抖音的网页版接口进行了升级导致解析失效。已为您把返回的完整网页源码保存到了下方路径，您可以去对应目录下双击用浏览器打开它以检查真正的错误原因：\n\
                 {}",
                title,
                html.len(),
                if has_captcha { "是" } else { "否" },
                write_status,
                error_file_path.to_string_lossy()
            ));
        }
    };

    let room = room_node.get("room").unwrap();
    let status = room.get("status").and_then(|s| s.as_i64()).unwrap_or(4);
    let is_live = status == 2; // 2 表示正在直播

    let anchor_name = room
        .get("owner")
        .and_then(|o| o.get("nickname"))
        .and_then(|n| n.as_str())
        .unwrap_or("未知主播")
        .to_string();

    let title = room
        .get("title")
        .and_then(|t| t.as_str())
        .unwrap_or("无标题")
        .to_string();

    let mut streams = Vec::new();

    if is_live {
        if let Some(stream_url_node) = room.get("stream_url") {
            // 抖音有多套流结构，我们主要解析 flv_pull_url 和 hls_pull_url_map
            let flv_map = stream_url_node
                .get("flv_pull_url")
                .and_then(|f| f.as_object());
            let hls_map = stream_url_node
                .get("hls_pull_url_map")
                .and_then(|h| h.as_object());

            // 收集所有可能的质量键
            let mut quality_keys = std::collections::HashSet::new();
            if let Some(map) = flv_map {
                for key in map.keys() {
                    quality_keys.insert(key.clone());
                }
            }
            if let Some(map) = hls_map {
                for key in map.keys() {
                    quality_keys.insert(key.clone());
                }
            }

            for key in quality_keys {
                let flv_url = flv_map
                    .and_then(|m| m.get(&key))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let m3u8_url = hls_map
                    .and_then(|m| m.get(&key))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                streams.push(LiveStream {
                    quality_name: map_quality_name(&key),
                    flv_url,
                    m3u8_url,
                });
            }
        }
    }

    Ok(LiveRoomInfo {
        room_id,
        anchor_name,
        title,
        is_live,
        streams,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_offline_room() {
        let room_id = "510200350291";
        let res = parse_douyin_live(room_id, "", "", "").await;
        println!("Result: {:?}", res);
        assert!(res.is_ok());
        let info = res.unwrap();
        assert_eq!(info.is_live, false);
        assert_eq!(info.streams.len(), 0);
    }
}

