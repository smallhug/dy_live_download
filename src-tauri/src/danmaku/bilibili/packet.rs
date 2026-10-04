use byteorder::{BigEndian, ByteOrder};
use flate2::read::ZlibDecoder;
use std::io::Read;

pub const HEADER_LEN: usize = 16;

pub const OP_HEARTBEAT: u32 = 2;
pub const OP_HEARTBEAT_REPLY: u32 = 3;
pub const OP_MESSAGE: u32 = 5;
pub const OP_AUTH: u32 = 7;
pub const OP_AUTH_REPLY: u32 = 8;

pub const PROTO_RAW: u16 = 0;
pub const PROTO_POPULARITY: u16 = 1;
pub const PROTO_ZLIB: u16 = 2;
pub const PROTO_BROTLI: u16 = 3;

/// Encodes an outgoing packet with the 16-byte Bilibili header
pub fn encode_packet(op: u32, proto_ver: u16, payload: &[u8]) -> Vec<u8> {
    let packet_len = (HEADER_LEN + payload.len()) as u32;
    let mut buf = vec![0u8; packet_len as usize];

    BigEndian::write_u32(&mut buf[0..4], packet_len);
    BigEndian::write_u16(&mut buf[4..6], HEADER_LEN as u16);
    BigEndian::write_u16(&mut buf[6..8], proto_ver);
    BigEndian::write_u32(&mut buf[8..12], op);
    BigEndian::write_u32(&mut buf[12..16], 1); // seq = 1

    buf[16..].copy_from_slice(payload);
    buf
}

/// Decodes incoming binary stream into a list of (op, raw_payload) tuples,
/// automatically handling nested Brotli and Zlib packets.
pub fn decode_packets(data: &[u8]) -> Result<Vec<(u32, Vec<u8>)>, String> {
    let mut results = Vec::new();
    let mut offset = 0;

    while offset + HEADER_LEN <= data.len() {
        let packet_len = BigEndian::read_u32(&data[offset..offset + 4]) as usize;
        let header_len = BigEndian::read_u16(&data[offset + 4..offset + 6]) as usize;
        let proto_ver = BigEndian::read_u16(&data[offset + 6..offset + 8]);
        let op = BigEndian::read_u32(&data[offset + 8..offset + 12]);

        if packet_len < HEADER_LEN || offset + packet_len > data.len() {
            break;
        }

        let body = &data[offset + header_len..offset + packet_len];

        match proto_ver {
            PROTO_RAW | PROTO_POPULARITY => {
                results.push((op, body.to_vec()));
            }
            PROTO_ZLIB => {
                let mut decoder = ZlibDecoder::new(body);
                let mut decompressed = Vec::new();
                if let Err(e) = decoder.read_to_end(&mut decompressed) {
                    log::warn!("[Danmaku/Bilibili] Zlib decompression failed: {}", e);
                } else if let Ok(sub_packets) = decode_packets(&decompressed) {
                    results.extend(sub_packets);
                }
            }
            PROTO_BROTLI => {
                let mut decompressed = Vec::new();
                let mut reader = brotli::Decompressor::new(body, 4096);
                if let Err(e) = reader.read_to_end(&mut decompressed) {
                    log::warn!("[Danmaku/Bilibili] Brotli decompression failed: {}", e);
                } else if let Ok(sub_packets) = decode_packets(&decompressed) {
                    results.extend(sub_packets);
                }
            }
            _ => {
                log::warn!("[Danmaku/Bilibili] Unknown proto_ver: {}", proto_ver);
            }
        }

        offset += packet_len;
    }

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encode_and_decode_raw_packet() {
        let payload = b"{\"test\":true}";
        let encoded = encode_packet(OP_MESSAGE, PROTO_RAW, payload);
        let decoded = decode_packets(&encoded).expect("decode failed");

        assert_eq!(decoded.len(), 1);
        assert_eq!(decoded[0].0, OP_MESSAGE);
        assert_eq!(decoded[0].1, payload);
    }
}
