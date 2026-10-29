//! Tests for `files/block_count.rs` (included via `#[path]`).
//!
//! The block estimate is the #1570 open-cost signal: WYSIWYG view construction
//! scales with block count, and the byte-only gate admitted a 524 KiB,
//! 3,773-block document that froze the window for over 30 s.

use super::*;
use crate::command_error::ErrorCode;
use std::io::Write;

/// Create a markdown-named file in a tempdir with the given bytes.
fn make_md_file(bytes: &[u8]) -> (tempfile::TempDir, std::path::PathBuf) {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("fixture.md");
    let mut file = std::fs::File::create(&path).expect("create");
    file.write_all(bytes).expect("write");
    (dir, path)
}

#[test]
fn block_estimate_counts_blank_separated_blocks() {
    let text = b"# Title\n\nfirst paragraph\n\n## Section\n\nsecond paragraph\n";
    assert_eq!(estimate_markdown_blocks(text), 4);
}

#[test]
fn block_estimate_counts_each_list_item_and_heading() {
    let text = b"- one\n- two\n- three\n\n# Heading\n\nparagraph\n";
    assert_eq!(estimate_markdown_blocks(text), 5);
}

#[test]
fn block_estimate_does_not_count_fenced_code_lines() {
    let text = b"# Setup\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n\ndone\n";
    assert_eq!(estimate_markdown_blocks(text), 3);
}

#[test]
fn block_estimate_treats_a_tilde_fence_as_one_block() {
    let text = b"~~~\nline one\n\nline two\n~~~\n";
    assert_eq!(estimate_markdown_blocks(text), 1);
}

#[test]
fn block_estimate_counts_a_blockquote_run_once() {
    let text = b"> line one\n> line two\n\nparagraph\n";
    assert_eq!(estimate_markdown_blocks(text), 2);
}

#[test]
fn block_estimate_counts_frontmatter_once() {
    let text = b"---\ntitle: x\n---\n\n# Heading\n\nparagraph\n";
    assert_eq!(estimate_markdown_blocks(text), 3);
}

#[test]
fn block_estimate_handles_crlf_and_a_leading_bom() {
    let text = b"\xEF\xBB\xBF# Heading\r\n\r\nfirst\r\n\r\nsecond\r\n";
    assert_eq!(estimate_markdown_blocks(text), 3);
}

#[test]
fn an_unterminated_leading_rule_is_not_frontmatter() {
    // remark-frontmatter requires a closing fence; without one, this is a
    // thematic break and the paragraphs below still count.
    let text = b"---\n\nfirst paragraph\n\nsecond paragraph\n";
    assert_eq!(estimate_markdown_blocks(text), 3);
}

#[test]
fn block_estimate_is_zero_for_blank_input() {
    assert_eq!(estimate_markdown_blocks(b""), 0);
    assert_eq!(estimate_markdown_blocks(b"\n\n   \n"), 0);
}

/// The block-count fixture from #1570: a heading, then one heading plus one
/// paragraph per section. Its generator prints `sections * 2 + 1` blocks, and
/// the estimate must agree or the routing threshold is calibrated against a
/// different unit.
#[test]
fn block_estimate_matches_the_issue_fixture_shape() {
    let sections = 1700;
    let mut lines = vec!["# blkA\n".to_string()];
    for i in 0..sections {
        lines.push(format!("## 第 {} 节\n", i + 1));
        lines.push("这是用于编辑器性能测试的原创占位文字。".repeat(4));
    }
    let text = lines.join("\n");
    assert_eq!(estimate_markdown_blocks(text.as_bytes()), sections * 2 + 1);
}

#[tokio::test]
async fn count_markdown_blocks_reports_the_estimate() {
    let (_dir, path) = make_md_file(b"# One\n\n- a\n- b\n\ntext\n");
    let blocks = count_markdown_blocks(path.to_string_lossy().into_owned())
        .await
        .expect("ok");
    assert_eq!(blocks, 4);
}

#[tokio::test]
async fn an_oversized_file_is_not_scanned() {
    // The router only asks for sub-1 MiB files; the cap keeps a misconfigured
    // caller from making this read an arbitrarily large file.
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("big.md");
    std::fs::write(&path, vec![b'a'; (MAX_BLOCK_SCAN_BYTES + 1) as usize]).expect("write");

    let blocks = count_markdown_blocks(path.to_string_lossy().into_owned())
        .await
        .expect("ok");
    assert_eq!(blocks, TOO_LARGE_TO_SCAN_BLOCKS);
}

#[tokio::test]
async fn count_markdown_blocks_rejects_a_directory() {
    let dir = tempfile::tempdir().expect("tempdir");
    let err = count_markdown_blocks(dir.path().to_string_lossy().into_owned())
        .await
        .expect_err("directories must be refused");
    assert_eq!(err.code(), ErrorCode::InvalidInput);
}
