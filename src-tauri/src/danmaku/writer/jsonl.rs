use crate::danmaku::model::LiveMessage;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::PathBuf;

pub struct JsonlDanmakuWriter {
    writer: BufWriter<File>,
    _path: PathBuf,
}

impl JsonlDanmakuWriter {
    pub fn new(path: PathBuf) -> Result<Self, std::io::Error> {
        let file = File::create(&path)?;
        let writer = BufWriter::new(file);
        Ok(Self { writer, _path: path })
    }

    pub fn write_message(&mut self, msg: &LiveMessage) -> Result<(), std::io::Error> {
        if let Ok(line) = serde_json::to_string(msg) {
            writeln!(self.writer, "{}", line)?;
        }
        Ok(())
    }

    pub fn flush(&mut self) -> Result<(), std::io::Error> {
        self.writer.flush()
    }

    pub fn finish(&mut self) -> Result<(), std::io::Error> {
        self.writer.flush()
    }
}
