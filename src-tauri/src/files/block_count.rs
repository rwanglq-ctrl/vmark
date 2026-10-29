//! # Markdown Block Count
//!
//! Purpose: estimate how many blocks a WYSIWYG view will build for a markdown
//! file, before the webview reads it. WYSIWYG open cost scales with block
//! count, not bytes: a 524 KB document of 3,773 short blocks froze the window
//! for over 30 s while the byte gate called it small (#1570).
//!
//! Pipeline: invoke("count_markdown_blocks") → fs::read (< 4 MiB) → line scan.
//!
//! Key decisions:
//!   - A LINE SCAN, not a markdown parse. A parse is the work being avoided,
//!     and the router only needs enough signal to cross a threshold.
//!   - Over-counting only routes a document to Source mode, which one click
//!     reverses; undercounting would bring the freeze back. So consecutive
//!     blockquote lines count once, while each list item and table row counts.
//!   - Files above `MAX_BLOCK_SCAN_BYTES` report `TOO_LARGE_TO_SCAN_BLOCKS`
//!     instead of being read: the router only asks for sub-1 MiB files, and a
//!     misconfigured caller must not make this read an arbitrarily large file.
//!
//! @coordinates-with files/ops.rs — the byte gate this signal joins
//! @coordinates-with src/services/navigation/largeFileRouting.ts — the caller
//! @module files/block_count

use crate::command_error::CommandError;
use crate::files::ops::validate_openable_path;
use std::fs;

/// Above this, the block scan refuses to read the file.
const MAX_BLOCK_SCAN_BYTES: u64 = 4 * 1024 * 1024;

/// Reported for an oversized file instead of a real count. Large enough to
/// cross any routing threshold, and still an exact `Number` in JavaScript.
const TOO_LARGE_TO_SCAN_BLOCKS: u64 = u32::MAX as u64;

/// Estimate how many markdown blocks a WYSIWYG view would build from `text`.
///
/// Counts blank-separated text, headings, list items, table rows and each
/// fenced block. Code inside a fence and frontmatter lines are skipped.
pub fn estimate_markdown_blocks(text: &[u8]) -> u64 {
    let mut count = 0u64;
    let mut in_fence: Option<(u8, usize)> = None;
    let mut in_frontmatter = false;
    let mut at_start = true;
    let mut pending_blank = true;
    let mut prev_quote = false;
    let mut prev_plain = false;

    for raw_line in text.split(|&byte| byte == b'\n') {
        let mut line = raw_line;
        let is_first_line = at_start;
        if is_first_line {
            at_start = false;
            if let Some(rest) = line.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
                line = rest;
            }
        }
        let line = trim_ascii(line);

        if in_frontmatter {
            if line == b"---" || line == b"..." {
                in_frontmatter = false;
            }
            continue;
        }

        // Frontmatter is one block, and only when it opens the document AND
        // has a closing fence. An unterminated leading `---` is a thematic
        // break, exactly as remark-frontmatter reads it.
        if is_first_line && line == b"---" && frontmatter_terminates(text) {
            in_frontmatter = true;
            count += 1;
            pending_blank = false;
            continue;
        }

        if let Some((marker, opening_len)) = in_fence {
            if let Some((closing_marker, closing_len, rest_blank)) = fence_run(line) {
                if closing_marker == marker && closing_len >= opening_len && rest_blank {
                    in_fence = None;
                    // A block that follows the closing fence starts a new one.
                    pending_blank = true;
                }
            }
            prev_quote = false;
            prev_plain = false;
            continue;
        }

        if line.is_empty() {
            pending_blank = true;
            prev_quote = false;
            prev_plain = false;
            continue;
        }

        if let Some((marker, len, _)) = fence_run(line) {
            count += 1;
            in_fence = Some((marker, len));
            pending_blank = false;
            prev_quote = false;
            prev_plain = false;
            continue;
        }

        // A setext heading underline belongs to the paragraph above it.
        if prev_plain && is_setext_underline(line) {
            pending_blank = false;
            prev_quote = false;
            prev_plain = false;
            continue;
        }

        let quote = line.first() == Some(&b'>');
        let starts = starts_block(line) && !(quote && prev_quote);
        if pending_blank || starts {
            count += 1;
        }
        pending_blank = false;
        prev_quote = quote;
        prev_plain = !starts;
    }

    count
}

/// Whether a document-leading `---` has a closing `---` or `...` fence.
fn frontmatter_terminates(text: &[u8]) -> bool {
    let mut lines = text.split(|&byte| byte == b'\n');
    let first = lines.next().unwrap_or(&[]);
    if trim_ascii(first.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(first)) != b"---" {
        return false;
    }
    lines.any(|line| {
        let line = trim_ascii(line);
        line == b"---" || line == b"..."
    })
}

/// Whitespace-trim ASCII bytes, including the `\r` of a CRLF line ending.
/// (`[u8]::trim_ascii` needs a newer toolchain than the crate pins.)
fn trim_ascii(mut bytes: &[u8]) -> &[u8] {
    while let Some((first, rest)) = bytes.split_first() {
        if first.is_ascii_whitespace() {
            bytes = rest;
        } else {
            break;
        }
    }
    while let Some((last, rest)) = bytes.split_last() {
        if last.is_ascii_whitespace() {
            bytes = rest;
        } else {
            break;
        }
    }
    bytes
}

/// `(marker, run length, nothing follows the run)` for a fence line, allowing
/// up to three spaces of indentation.
fn fence_run(line: &[u8]) -> Option<(u8, usize, bool)> {
    let indent = line.iter().take_while(|&&byte| byte == b' ').count();
    if indent > 3 {
        return None;
    }
    let rest = &line[indent..];
    let marker = *rest.first()?;
    if marker != b'`' && marker != b'~' {
        return None;
    }
    let len = rest.iter().take_while(|&&byte| byte == marker).count();
    if len < 3 {
        return None;
    }
    Some((marker, len, trim_ascii(&rest[len..]).is_empty()))
}

fn starts_block(line: &[u8]) -> bool {
    starts_heading(line)
        || starts_list_item(line)
        || line.first() == Some(&b'|')
        || line.first() == Some(&b'>')
        || starts_thematic_break(line)
        || starts_html_block(line)
}

fn starts_heading(line: &[u8]) -> bool {
    let hashes = line.iter().take_while(|&&byte| byte == b'#').count();
    (1..=6).contains(&hashes) && matches!(line.get(hashes), None | Some(b' ') | Some(b'\t'))
}

fn starts_list_item(line: &[u8]) -> bool {
    let indent = line.iter().take_while(|&&byte| byte == b' ').count();
    let rest = &line[indent..];
    match rest.first() {
        Some(b'-' | b'*' | b'+') => matches!(rest.get(1), None | Some(b' ') | Some(b'\t')),
        Some(byte) if byte.is_ascii_digit() => {
            let digits = rest.iter().take_while(|&&b| b.is_ascii_digit()).count();
            if digits > 9 {
                return false;
            }
            matches!(rest.get(digits), Some(b'.') | Some(b')'))
                && matches!(rest.get(digits + 1), None | Some(b' ') | Some(b'\t'))
        }
        _ => false,
    }
}

fn starts_thematic_break(line: &[u8]) -> bool {
    let mut marker = None;
    let mut marks = 0usize;
    for &byte in line {
        match byte {
            b' ' | b'\t' => continue,
            b'-' | b'*' | b'_' => {
                if marker.is_some() && marker != Some(byte) {
                    return false;
                }
                marker = Some(byte);
                marks += 1;
            }
            _ => return false,
        }
    }
    marks >= 3
}

fn starts_html_block(line: &[u8]) -> bool {
    let Some(rest) = line.strip_prefix(b"<") else {
        return false;
    };
    matches!(rest.first(), Some(byte) if byte.is_ascii_alphabetic() || matches!(byte, b'/' | b'!' | b'?'))
}

fn is_setext_underline(line: &[u8]) -> bool {
    let mut marker = None;
    for &byte in line {
        match byte {
            b' ' | b'\t' => continue,
            b'=' | b'-' => {
                if marker.is_some() && marker != Some(byte) {
                    return false;
                }
                marker = Some(byte);
            }
            _ => return false,
        }
    }
    marker.is_some()
}

/// Count the blocks a WYSIWYG view would build. The router's pre-read gate.
#[tauri::command]
pub async fn count_markdown_blocks(path: String) -> Result<u64, CommandError> {
    validate_openable_path(&path)?;
    let metadata = fs::metadata(&path)
        .map_err(|e| CommandError::from_io(&e, format!("Failed to stat {path}: {e}")))?;
    if metadata.len() > MAX_BLOCK_SCAN_BYTES {
        return Ok(TOO_LARGE_TO_SCAN_BLOCKS);
    }

    let scan_path = path.clone();
    let bytes = tokio::task::spawn_blocking(move || fs::read(&scan_path))
        .await
        .map_err(|e| CommandError::internal(format!("Block scan task failed: {e}")))?
        .map_err(|e| CommandError::from_io(&e, format!("Failed to read {path}: {e}")))?;
    Ok(estimate_markdown_blocks(&bytes))
}

#[cfg(test)]
#[path = "block_count.test.rs"]
mod tests;
