use crate::danmaku::model::{LiveMessage, LiveMessagePayload};
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::PathBuf;

pub struct XmlDanmakuWriter {
    writer: BufWriter<File>,
    _path: PathBuf,
}

impl XmlDanmakuWriter {
    pub fn new(path: PathBuf) -> Result<Self, std::io::Error> {
        let file = File::create(&path)?;
        let mut writer = BufWriter::new(file);

        // Write standard XML Danmaku header
        writeln!(writer, "<?xml version=\"1.0\" encoding=\"UTF-8\"?>")?;
        writeln!(writer, "<i>")?;
        writeln!(writer, "  <chatserver>live-recorder</chatserver>")?;
        writeln!(writer, "  <chatid>0</chatid>")?;
        writeln!(writer, "  <mission>0</mission>")?;
        writeln!(writer, "  <maxlimit>99999</maxlimit>")?;
        writeln!(writer, "  <source>k-v</source>")?;

        Ok(Self { writer, _path: path })
    }

    pub fn write_message(&mut self, msg: &LiveMessage, start_time_ms: u64) -> Result<(), std::io::Error> {
        let content = match &msg.payload {
            LiveMessagePayload::Chat { content, .. } => content.clone(),
            LiveMessagePayload::Gift { gift_name, count, .. } => {
                format!("[送出礼物: {} x{}]", gift_name, count)
            }
            LiveMessagePayload::SuperChat { content, price_rmb, .. } => {
                format!("[醒目留言 ¥{:.1}]: {}", price_rmb, content)
            }
            _ => return Ok(()), // Don't write enter/like to XML subtitle file
        };

        let offset_secs = if msg.timestamp_ms >= start_time_ms {
            (msg.timestamp_ms - start_time_ms) as f64 / 1000.0
        } else {
            0.0
        };

        let color_dec = match &msg.payload {
            LiveMessagePayload::Chat { color: Some(hex), .. } => {
                let clean = hex.trim_start_matches('#');
                u32::from_str_radix(clean, 16).unwrap_or(16777215)
            }
            LiveMessagePayload::SuperChat { .. } => 16763904, // Orange/Gold for SuperChat
            LiveMessagePayload::Gift { .. } => 16750848,      // Yellow-Red for Gifts
            _ => 16777215, // White
        };

        let escaped_content = escape_xml(&content);
        let unix_time = msg.timestamp_ms / 1000;

        writeln!(
            self.writer,
            "  <d p=\"{:.3},1,25,{},{},0,{},0\">{}</d>",
            offset_secs, color_dec, unix_time, msg.user.user_id, escaped_content
        )?;

        Ok(())
    }

    pub fn flush(&mut self) -> Result<(), std::io::Error> {
        self.writer.flush()
    }

    pub fn finish(&mut self) -> Result<(), std::io::Error> {
        writeln!(self.writer, "</i>")?;
        self.writer.flush()
    }
}

fn escape_xml(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            other => out.push(other),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_escape_xml() {
        assert_eq!(escape_xml("a < b & c > d \"hello\""), "a &lt; b &amp; c &gt; d &quot;hello&quot;");
    }
}
