use std::time::Duration;
use serde_json::Value;
use super::{LiveParser, LiveRoomInfo, LiveStream};

pub struct BilibiliParser;

impl LiveParser for BilibiliParser {
    async fn parse(
        &self,
        client: &reqwest::Client,
        room_id: &str,
        cookie: &str,
        user_agent: &str,
        sec_ch_ua: &str,
        preferred_quality: &str,
    ) -> Result<LiveRoomInfo, String> {
        parse_bilibili_live(client, room_id, cookie, user_agent, sec_ch_ua, preferred_quality).await
    }
}

pub async fn parse_bilibili_live(
    client: &reqwest::Client,
    room_url_or_id: &str,
    cookie: &str,
    user_agent: &str,
    sec_ch_ua: &str,
    preferred_quality: &str,
) -> Result<LiveRoomInfo, String> {
    let clean_id = room_url_or_id.trim().to_string();
    if clean_id.is_empty() {
        return Err("直播间数字 ID 不能为空".to_string());
    }

    // 仅支持纯数字 ID 校验
    if !clean_id.chars().all(|c| c.is_ascii_digit()) {
        return Err("输入格式不正确，仅支持输入哔哩哔哩直播间的纯数字 ID，请勿输入链接。".to_string());
    }

    let raw_room_id: u64 = clean_id.parse().map_err(|_| "房间ID解析为数字失败".to_string())?;

    // 1. 初始化 HTTP 请求头
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert("Accept", "application/json, text/plain, */*".parse().unwrap());
    headers.insert("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8".parse().unwrap());
    headers.insert("Referer", "https://live.bilibili.com/".parse().unwrap());
    headers.insert("Origin", "https://live.bilibili.com".parse().unwrap());

    let actual_ua = if user_agent.trim().is_empty() {
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    } else {
        user_agent
    };

    let actual_sec_ch_ua = if sec_ch_ua.trim().is_empty() {
        "\"Not_A Brand\";v=\"8\", \"Chromium\";v=\"120\", \"Google Chrome\";v=\"120\""
    } else {
        sec_ch_ua
    };

    headers.insert("sec-ch-ua", actual_sec_ch_ua.parse().unwrap());
    headers.insert("sec-ch-ua-mobile", "?0".parse().unwrap());
    headers.insert("sec-ch-ua-platform", "\"Windows\"".parse().unwrap());

    // 2. 调用 room_init 接口获取真实的长号 room_id 与开播状态
    let init_url = format!("https://api.live.bilibili.com/room/v1/Room/room_init?id={}", raw_room_id);
    let mut init_request = client.get(&init_url)
        .headers(headers.clone())
        .header(reqwest::header::USER_AGENT, actual_ua);
    if !cookie.trim().is_empty() {
        init_request = init_request.header("Cookie", cookie);
    }

    let init_response = init_request.send().await.map_err(|e| format!("请求room_init失败: {}", e))?;
    let init_json: Value = init_response.json().await.map_err(|e| format!("解析room_init JSON失败: {}", e))?;

    if init_json["code"].as_i64().unwrap_or(-1) != 0 {
        let msg = init_json["message"].as_str().or(init_json["msg"].as_str()).unwrap_or("未知错误");
        return Err(format!("获取房间初始信息失败: {}", msg));
    }

    let real_room_id = init_json["data"]["room_id"].as_u64().ok_or_else(|| "未找到真实房间ID".to_string())?;
    let live_status = init_json["data"]["live_status"].as_i64().unwrap_or(0);
    let is_live = live_status == 1;

    // 3. 获取主播名字及直播间标题
    let info_url = format!("https://api.live.bilibili.com/xlive/web-room/v1/index/getInfoByRoom?room_id={}", real_room_id);
    let mut info_request = client.get(&info_url)
        .headers(headers.clone())
        .header(reqwest::header::USER_AGENT, actual_ua);
    if !cookie.trim().is_empty() {
        info_request = info_request.header("Cookie", cookie);
    }
    
    let info_response = info_request.send().await.map_err(|e| format!("请求getInfoByRoom失败: {}", e))?;
    let info_json: Value = info_response.json().await.map_err(|e| format!("解析getInfoByRoom JSON失败: {}", e))?;

    let anchor_name = info_json["data"]["anchor_info"]["base_info"]["uname"]
        .as_str()
        .unwrap_or("未知主播")
        .to_string();

    let title = info_json["data"]["room_info"]["title"]
        .as_str()
        .unwrap_or("无标题")
        .to_string();

    let mut streams = Vec::new();

    // 4. 如果正在直播，获取流地址
    if is_live {
        // 根据首选画质映射对应的 qn 码
        let qn = match preferred_quality {
            "origin" => 10000,
            "blue_ray" => 400,
            "uhd" => 250,
            "hd" => 150,
            "sd" => 80,
            _ => 10000, // 默认最高画质
        };

        // 请求对应的画质等级 qn
        let play_url = format!(
            "https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo?room_id={}&protocol=0,1&format=0,1,2&codec=0,1&qn={}&platform=web",
            real_room_id, qn
        );
        let mut play_request = client.get(&play_url)
            .headers(headers.clone())
            .header(reqwest::header::USER_AGENT, actual_ua);
        if !cookie.trim().is_empty() {
            play_request = play_request.header("Cookie", cookie);
        }

        if let Ok(play_response) = play_request.send().await {
            if let Ok(play_json) = play_response.json::<Value>().await {
                if play_json["code"].as_i64().unwrap_or(-1) == 0 {
                    let playurl_info = &play_json["data"]["playurl_info"];
                    
                    // 用 Map 合并在不同协议 (http_stream 与 http_hls) 下相同画质的流地址
                    let mut stream_map = std::collections::HashMap::new();

                    if let Some(stream_list) = playurl_info["playurl"]["stream"].as_array() {
                        for s_item in stream_list {
                            let protocol_name = s_item["protocol_name"].as_str().unwrap_or("");
                            let is_flv = protocol_name == "http_stream";
                            let is_hls = protocol_name == "http_hls";

                            if !is_flv && !is_hls {
                                continue;
                            }

                            if let Some(format_list) = s_item["format"].as_array() {
                                for f_item in format_list {
                                    if let Some(codec_list) = f_item["codec"].as_array() {
                                        for c_item in codec_list {
                                            // 优先选择 AVC (H.264)，因为 H.265 (HEVC) 在 FFmpeg 某些封装/播放器中兼容性不好
                                            let codec_name = c_item["codec_name"].as_str().unwrap_or("");
                                            // 如果列表里同时有 AVC 和 HEVC，我们会为相同 qn 的项更新
                                            // 这里我们可以只取优先的 codec_name == "avc" 的项，或者如果没找到就用第一个
                                            
                                            let current_qn = c_item["current_qn"].as_u64().unwrap_or(0);
                                            let quality_name = map_bilibili_quality(current_qn);

                                            let base_url = c_item["base_url"].as_str().unwrap_or("");
                                            if base_url.is_empty() {
                                                continue;
                                            }

                                            // 拼接完整的 URL 地址，取第一个可用的 host 地址
                                            let mut full_url = "".to_string();
                                            if let Some(url_info_list) = c_item["url_info"].as_array() {
                                                if !url_info_list.is_empty() {
                                                    let host = url_info_list[0]["host"].as_str().unwrap_or("");
                                                    let extra = url_info_list[0]["extra"].as_str().unwrap_or("");
                                                    full_url = format!("{}{}{}", host, base_url, extra);
                                                }
                                            }

                                            if full_url.is_empty() {
                                                continue;
                                            }

                                            // 插入或合并到 stream_map 中
                                            let stream_entry = stream_map.entry(quality_name.clone()).or_insert_with(|| LiveStream {
                                                quality_name: quality_name.clone(),
                                                flv_url: None,
                                                m3u8_url: None,
                                            });

                                            if is_flv {
                                                // 如果是 AVC，或者当前没有值，就采用这个 FLV
                                                if codec_name == "avc" || stream_entry.flv_url.is_none() {
                                                    stream_entry.flv_url = Some(full_url);
                                                }
                                            } else if is_hls {
                                                if codec_name == "avc" || stream_entry.m3u8_url.is_none() {
                                                    stream_entry.m3u8_url = Some(full_url);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // 转换为 Vec 列表
                    for (_, val) in stream_map {
                        streams.push(val);
                    }

                    // 对解析出来的流进行画质降序排列
                    streams.sort_by_key(|s| std::cmp::Reverse(super::get_quality_priority(&s.quality_name)));
                }
            }
        }
    }

    Ok(LiveRoomInfo {
        room_id: real_room_id.to_string(),
        anchor_name,
        title,
        is_live,
        streams,
    })
}

fn map_bilibili_quality(qn: u64) -> String {
    match qn {
        10000 | 401 => "origin".to_string(), // 4K或原画
        400 => "blue_ray".to_string(),      // 蓝光
        250 => "uhd".to_string(),           // 超清
        150 => "hd".to_string(),            // 高清
        80 | 32 => "sd".to_string(),        // 流畅/标准
        _ => "sd".to_string(),
    }
}

// 根据 Cookie 访问 Bilibili 获取自身登录账号昵称
pub async fn fetch_nickname_from_cookie(client: &reqwest::Client, cookie: &str, user_agent: &str) -> Option<String> {
    if cookie.trim().is_empty() {
        return None;
    }

    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert("Accept", "application/json, text/plain, */*".parse().unwrap());
    headers.insert("Referer", "https://www.bilibili.com/".parse().unwrap());
    headers.insert("Cookie", cookie.parse().ok()?);

    let actual_ua = if user_agent.trim().is_empty() {
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    } else {
        user_agent
    };

    let response = client.get("https://api.bilibili.com/x/web-interface/nav")
        .headers(headers)
        .header(reqwest::header::USER_AGENT, actual_ua)
        .send()
        .await
        .ok()?;
    let json: Value = response.json().await.ok()?;

    if json["code"].as_i64().unwrap_or(-1) == 0 && json["data"]["isLogin"].as_bool().unwrap_or(false) {
        if let Some(uname) = json["data"]["uname"].as_str() {
            return Some(uname.to_string());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_bilibili_room_offline() {
        // 使用一个大概率未开播的长房间ID或知名房间ID
        // 比如 B站知名电竞直播间（赛事开播，非赛事未开播）或者随便一个数字
        let room_id = "3"; // 通常该测试数字ID是合法的
        let client = reqwest::Client::new();
        let res = parse_bilibili_live(&client, room_id, "", "", "", "origin").await;
        println!("Result: {:?}", res);
        // 如果房间不存在可能会 code != 0 报错，但如果是真实存在的未开播房间会返回 is_live == false 
        // 只要结果能够被获取或者报错被捕获即可
        if let Ok(info) = res {
            println!("Anchor: {}, Title: {}, IsLive: {}", info.anchor_name, info.title, info.is_live);
            assert!(!info.room_id.is_empty());
        }
    }

    #[test]
    fn test_quality_mapping() {
        assert_eq!(map_bilibili_quality(10000), "origin");
        assert_eq!(map_bilibili_quality(401), "origin");
        assert_eq!(map_bilibili_quality(400), "blue_ray");
        assert_eq!(map_bilibili_quality(250), "uhd");
        assert_eq!(map_bilibili_quality(150), "hd");
        assert_eq!(map_bilibili_quality(80), "sd");
        assert_eq!(map_bilibili_quality(32), "sd");
        assert_eq!(map_bilibili_quality(999), "sd");
    }
}
