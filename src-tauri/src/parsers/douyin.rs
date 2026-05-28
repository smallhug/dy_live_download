use std::sync::LazyLock;
use regex::Regex;
use serde_json::Value;
use url::form_urlencoded;
use super::{LiveParser, LiveRoomInfo, LiveStream};

static RE_PACE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"self\.__pace_f\.push\(\[\s*\d+\s*,\s*"(.*?)"\s*\]\)"#).unwrap());
static RE_RENDER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"<script\s+id="RENDER_DATA"\s+type="application/json">([^<]+)</script>"#).unwrap());
static RE_TITLE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<title>([^<]+)</title>").unwrap());

pub struct DouyinParser;

impl LiveParser for DouyinParser {
    async fn parse(
        &self,
        client: &reqwest::Client,
        room_id: &str,
        cookie: &str,
        user_agent: &str,
        sec_ch_ua: &str,
        _preferred_quality: &str,
    ) -> Result<LiveRoomInfo, String> {
        parse_douyin_live(client, room_id, cookie, user_agent, sec_ch_ua).await
    }
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

// 映射画质名称为友好英文标识
fn map_quality_name(key: &str) -> String {
    let upper_key = key.to_uppercase();
    match upper_key.as_str() {
        "ORIGIN" | "OD" | "OR4" => "origin".to_string(),
        "BLUE_LIGHT" | "BLUE" | "BD" => "blue_ray".to_string(),
        "FULL_HD1" | "FULL_HD" | "UHD" => "uhd".to_string(),
        "HD1" | "HD" => "hd".to_string(),
        "SD1" | "SD" | "SD2" => "sd".to_string(),
        _ => key.to_string(),
    }
}

pub async fn parse_douyin_live(
    client: &reqwest::Client,
    room_url: &str,
    cookie: &str,
    user_agent: &str,
    sec_ch_ua: &str,
) -> Result<LiveRoomInfo, String> {
    let clean_id = room_url.trim().to_string();
    if clean_id.is_empty() {
        return Err("直播间数字 ID 不能为空".to_string());
    }

    // 仅支持纯数字 ID 校验
    if !clean_id.chars().all(|c| c.is_ascii_digit()) {
        return Err("输入格式不正确，仅支持输入抖音直播间的纯数字 ID，请勿粘贴链接。".to_string());
    }

    let room_id = clean_id.clone();
    let actual_url = format!("https://live.douyin.com/{}", room_id);

    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7".parse().unwrap());
    headers.insert("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6".parse().unwrap());
    headers.insert("Referer", "https://live.douyin.com/".parse().unwrap());

    // 优先采用配置 of UA 与 sec-ch-ua，若空则使用 Edge 147 的默认值
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

    let mut request = client.get(&actual_url)
        .headers(headers)
        .header(reqwest::header::USER_AGENT, actual_ua);
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

            let has_captcha = html.contains("secsdk-captcha") || 
                              html.contains("captcha-verify-image") ||
                              html.contains("verify-image") ||
                              (html.contains("captcha") && html.contains("验证码"));

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

            // 对解析到的 streams 按照画质优先级进行从高到低排序
            streams.sort_by_key(|s| std::cmp::Reverse(super::get_quality_priority(&s.quality_name)));
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

pub async fn fetch_nickname_from_cookie(client: &reqwest::Client, cookie: &str, user_agent: &str) -> Option<String> {
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8".parse().unwrap());
    headers.insert("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8".parse().unwrap());
    headers.insert("Cookie", cookie.parse().ok()?);

    let res = client.get("https://www.douyin.com/")
        .headers(headers)
        .header(reqwest::header::USER_AGENT, user_agent)
        .send()
        .await
        .ok()?;
    let html = res.text().await.ok()?;

    // 匹配个人中心或抖音首页中的 title
    if let Some(caps) = RE_TITLE.captures(&html) {
        let title = caps.get(1)?.as_str().trim();
        if title.contains("的抖音") {
            return Some(title.replace("的抖音", "").replace(" - 抖音", "").trim().to_string());
        }
        if title.contains("的个人主页") {
            return Some(title.replace("的个人主页", "").replace(" - 抖音", "").trim().to_string());
        }
        if title.contains("的首页") {
            return Some(title.replace("的首页", "").replace(" - 抖音", "").trim().to_string());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_offline_room() {
        let room_id = "510200350291";
        let client = reqwest::Client::new();
        let res = parse_douyin_live(&client, room_id, "", "", "").await;
        assert!(res.is_ok());
        let info = res.unwrap();
        assert_eq!(info.is_live, false);
        assert_eq!(info.streams.len(), 0);
    }
    #[test]
    fn test_quality_mapping() {
        assert_eq!(map_quality_name("ORIGIN"), "origin");
        assert_eq!(map_quality_name("od"), "origin");
        assert_eq!(map_quality_name("or4"), "origin");
        
        assert_eq!(map_quality_name("blue_light"), "blue_ray");
        assert_eq!(map_quality_name("BD"), "blue_ray");
        
        assert_eq!(map_quality_name("FULL_HD1"), "uhd");
        assert_eq!(map_quality_name("uhd"), "uhd");
        
        assert_eq!(map_quality_name("hd1"), "hd");
        assert_eq!(map_quality_name("HD"), "hd");
        
        assert_eq!(map_quality_name("sd2"), "sd");
        assert_eq!(map_quality_name("SD"), "sd");
        
        assert_eq!(map_quality_name("random_key"), "random_key");
    }

    #[test]
    fn test_select_best_stream() {
        let streams = vec![
            LiveStream {
                quality_name: "uhd".to_string(),
                flv_url: Some("url_uhd".to_string()),
                m3u8_url: None,
            },
            LiveStream {
                quality_name: "hd".to_string(),
                flv_url: Some("url_hd".to_string()),
                m3u8_url: None,
            },
            LiveStream {
                quality_name: "sd".to_string(),
                flv_url: Some("url_sd".to_string()),
                m3u8_url: None,
            },
        ];

        // 1. 首选原画，由于只有 uhd, hd, sd，因此应该智能降级到最清晰的 uhd
        let match_origin = super::super::select_best_stream(&streams, "origin").unwrap();
        assert_eq!(match_origin.quality_name, "uhd");

        // 2. 首选蓝光，降级到 uhd
        let match_blue = super::super::select_best_stream(&streams, "blue_ray").unwrap();
        assert_eq!(match_blue.quality_name, "uhd");

        // 3. 首选超清，精确匹配到 uhd
        let match_uhd = super::super::select_best_stream(&streams, "uhd").unwrap();
        assert_eq!(match_uhd.quality_name, "uhd");

        // 4. 首选标清，精确匹配到 sd
        let match_sd = super::super::select_best_stream(&streams, "sd").unwrap();
        assert_eq!(match_sd.quality_name, "sd");

        // 5. 空流情况
        assert!(super::super::select_best_stream(&[], "origin").is_none());
    }
}
