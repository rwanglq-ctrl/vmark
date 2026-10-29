/**
 * File Size and Block Thresholds
 *
 * Purpose: Centralizes the thresholds that decide how VMark handles a file at
 * open time. Two signals feed one gate: byte size, free from `fs::metadata`,
 * and an estimated markdown block count — the quantity ProseMirror view
 * construction actually scales with (#1570). Bytes alone admitted a 524 KB
 * document with 3,773 blocks that froze the window for over 30 s.
 *
 * Tier semantics:
 *   - "small"   → default WYSIWYG open, no indicator — unless the block
 *                 estimate crosses `SOURCE_MODE_DEFAULT_BLOCKS`.
 *   - "large"   → opens in Source mode by default (sub-second open).
 *                 StatusBar offers an explicit upgrade to WYSIWYG.
 *   - "huge"    → pre-open warning dialog; Open proceeds to Source mode only.
 *   - "refused" → no open attempt; liability floor for webview memory safety.
 *
 * @coordinates-with hooks/useFinderFileOpen.ts — routes pre-read on size tier.
 * @coordinates-with services/navigation/fileOpen.ts — shared open helper consults tier.
 * @coordinates-with services/navigation/largeFileRouting.ts — applies the block
 *   threshold for files below the byte threshold.
 * @coordinates-with stores/settingsStore.ts — user-togglable thresholds honor
 *   `largeFile.autoSourceMode` and `largeFile.warnAbove5MB`.
 * @module utils/fileSizeThresholds
 */

/** Byte and block thresholds. Values are conservative defaults; revisit with more corpora. */
export const FILE_SIZE_THRESHOLDS = {
  /** Below this size the open is perceptually instant; no indicator needed. */
  SHOW_PROGRESS_BYTES: 300 * 1024,
  /** At or above this size, auto-route to Source mode (user-togglable). */
  SOURCE_MODE_DEFAULT_BYTES: 1024 * 1024,
  /**
   * At or above this estimated block count, auto-route a markdown file to
   * Source mode even when its bytes are under the threshold (user-togglable).
   *
   * Calibration (#1570, WebKitGTK on a 16-core Intel laptop): WYSIWYG open
   * costs about 5 ms per block above a fixed ~3 s. 1,200 blocks is therefore
   * ~6 s of main-thread work — the point where the window stops answering.
   * The 1,170-block fixture from #1565 stays in WYSIWYG; the 3,773-block
   * document that froze for 31 s routes to Source in under a second.
   */
  SOURCE_MODE_DEFAULT_BLOCKS: 1200,
  /** At or above this size, confirm with a pre-open dialog (user-togglable). */
  WARN_BEFORE_OPEN_BYTES: 5 * 1024 * 1024,
  /** Hard refusal floor. Not user-togglable. */
  HARD_REFUSE_BYTES: 50 * 1024 * 1024,
} as const;

export type FileSizeTier = "small" | "large" | "huge" | "refused";

/**
 * Classify a file size into its UX tier.
 *
 * @param bytes Raw byte count from `fs::metadata`. Non-finite and negative
 *   values are treated as "small" — the caller will run the existing error
 *   path when the subsequent read fails.
 */
export function classifyFileSize(bytes: number): FileSizeTier {
  if (!Number.isFinite(bytes) || bytes < 0) return "small";
  if (bytes >= FILE_SIZE_THRESHOLDS.HARD_REFUSE_BYTES) return "refused";
  if (bytes >= FILE_SIZE_THRESHOLDS.WARN_BEFORE_OPEN_BYTES) return "huge";
  if (bytes >= FILE_SIZE_THRESHOLDS.SOURCE_MODE_DEFAULT_BYTES) return "large";
  return "small";
}

/** Whether the indeterminate open indicator should appear for this size. */
export function shouldShowProgressIndicator(bytes: number): boolean {
  return Number.isFinite(bytes) && bytes >= FILE_SIZE_THRESHOLDS.SHOW_PROGRESS_BYTES;
}

/**
 * Whether an estimated block count is expensive enough to auto-route to
 * Source mode. Non-finite values stay in WYSIWYG — the estimate is a
 * best-effort signal, and a failed count must not silently force a mode.
 */
export function shouldSourceModeForBlocks(blocks: number): boolean {
  return Number.isFinite(blocks) && blocks >= FILE_SIZE_THRESHOLDS.SOURCE_MODE_DEFAULT_BLOCKS;
}

/** Human-readable file size with 1-decimal precision (SI/power-of-two hybrid used by macOS Finder). */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 100 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(gb >= 100 ? 0 : 1)} GB`;
}
