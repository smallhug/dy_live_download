pub mod jsonl;
pub mod xml;

use crate::danmaku::model::LiveMessage;
use jsonl::JsonlDanmakuWriter;
use std::path::PathBuf;
use xml::XmlDanmakuWriter;

pub enum DanmakuFileWriter {
    Xml(XmlDanmakuWriter),
    Jsonl(JsonlDanmakuWriter),
}

impl DanmakuFileWriter {
    pub fn create(path: PathBuf, format: &str) -> Result<Self, std::io::Error> {
        match format {
            "jsonl" => Ok(DanmakuFileWriter::Jsonl(JsonlDanmakuWriter::new(path)?)),
            _ => Ok(DanmakuFileWriter::Xml(XmlDanmakuWriter::new(path)?)),
        }
    }

    pub fn write_message(&mut self, msg: &LiveMessage, start_time_ms: u64) -> Result<(), std::io::Error> {
        match self {
            DanmakuFileWriter::Xml(w) => w.write_message(msg, start_time_ms),
            DanmakuFileWriter::Jsonl(w) => w.write_message(msg),
        }
    }

    pub fn flush(&mut self) -> Result<(), std::io::Error> {
        match self {
            DanmakuFileWriter::Xml(w) => w.flush(),
            DanmakuFileWriter::Jsonl(w) => w.flush(),
        }
    }

    pub fn finish(&mut self) -> Result<(), std::io::Error> {
        match self {
            DanmakuFileWriter::Xml(w) => w.finish(),
            DanmakuFileWriter::Jsonl(w) => w.finish(),
        }
    }
}
