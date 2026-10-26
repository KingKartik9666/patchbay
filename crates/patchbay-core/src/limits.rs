use crate::{DomainError, ErrorCode};
use serde::Serialize;
use std::io::{self, Write};

pub const MAX_PROJECT_BYTES: usize = 1_048_576;
pub const MAX_INPUT_UTF16_UNITS: usize = 4096;
pub const MAX_RESPONSE_BYTES: usize = 16_777_216;
pub const MAX_DIAGNOSTICS: usize = 256;

pub(crate) fn check_source(source: &str) -> Result<(), DomainError> {
    if source.len() > MAX_PROJECT_BYTES {
        Err(DomainError::limit(
            "Project text exceeds the 1 MiB UTF-8 limit.",
        ))
    } else {
        Ok(())
    }
}
pub(crate) fn check_input(input: &str) -> Result<(), DomainError> {
    if input.encode_utf16().take(MAX_INPUT_UTF16_UNITS + 1).count() > MAX_INPUT_UTF16_UNITS {
        Err(DomainError::limit(
            "Input exceeds the 4096 UTF-16 unit limit.",
        ))
    } else {
        Ok(())
    }
}

struct SizeWriter {
    remaining: usize,
    exceeded: bool,
}
impl Write for SizeWriter {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        if buffer.len() > self.remaining {
            self.exceeded = true;
            return Err(io::Error::other("serialized size limit"));
        }
        self.remaining -= buffer.len();
        Ok(buffer.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}
/// Counts JSON bytes without allocating a serialized copy of the payload.
pub(crate) fn bound_serialized<T: Serialize>(
    value: &T,
    limit: usize,
    label: &str,
) -> Result<(), DomainError> {
    let mut writer = SizeWriter {
        remaining: limit,
        exceeded: false,
    };
    match serde_json::to_writer(&mut writer, value) {
        Ok(()) => Ok(()),
        Err(_) if writer.exceeded => Err(DomainError::limit(format!(
            "{label} exceeds its serialized byte budget."
        ))),
        Err(_) => Err(DomainError::new(
            ErrorCode::Internal,
            format!("Unable to serialize {label}."),
        )),
    }
}

pub(crate) fn charge(
    used: &mut usize,
    bytes: usize,
    maximum: usize,
    label: &str,
) -> Result<(), DomainError> {
    *used = used
        .checked_add(bytes)
        .ok_or_else(|| DomainError::limit(format!("{label} exceeds its byte budget.")))?;
    if *used > maximum {
        Err(DomainError::limit(format!(
            "{label} exceeds its byte budget."
        )))
    } else {
        Ok(())
    }
}

pub(crate) fn clipped(value: &str) -> String {
    let mut chars = value.chars();
    let mut text = chars.by_ref().take(500).collect::<String>();
    if chars.next().is_some() {
        text.push('…');
    }
    text
}

#[derive(Default)]
pub(crate) struct Diagnostics {
    values: Vec<String>,
}
impl Diagnostics {
    pub(crate) fn push(&mut self, value: impl AsRef<str>) {
        if !self.full() {
            self.values.push(clipped(value.as_ref()));
        }
    }
    pub(crate) fn full(&self) -> bool {
        self.values.len() >= MAX_DIAGNOSTICS
    }
    pub(crate) fn finish(mut self) -> Vec<String> {
        if self.full() {
            self.values.push(
                "Additional diagnostics omitted; fix the listed errors and inspect again.".into(),
            );
        }
        self.values
    }
}
