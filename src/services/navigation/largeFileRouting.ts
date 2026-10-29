/**
 * Large File Open Routing
 *
 * Purpose: Single pre-read gate for every path that opens a markdown file into
 * a tab (Finder, drag-drop, Open dialog, Tauri emit, CLI, hot exit restore).
 * Centralizing the decision keeps all open paths honest without each hook
 * re-implementing the size check and the interaction with user settings.
 *
 * Flow:
 *   1. Invoke `get_file_size_bytes` (a stat — cheap; no content IO).
 *   2. Classify into a FileSizeTier.
 *   3. For "refused": show the error dialog, tell the caller to bail.
 *   4. For "huge" (and `warnAbove5MB` on): prompt; caller bails on cancel.
 *   5. For "huge"/"large" (when `autoSourceMode` on): tell the caller to open
 *      in Source mode. Caller is responsible for calling `setSourceMode(true)`
 *      and `markForcedSource(tabId)` at the right moment in its own flow.
 *   6. For a "small" markdown file, estimate its block count. WYSIWYG cost
 *      scales with blocks, not bytes: a 500 KB document of 3,773 blocks froze
 *      the window for 31 s (#1570) while the 1 MiB byte gate called it small.
 *      A dense file takes the same Source-mode route.
 *
 * Errors from `get_file_size_bytes` (missing file, permission denied) are NOT
 * surfaced here — we resolve as a best-effort "small" and let the caller's
 * existing error path (the `readDocumentText` that follows) report the failure
 * with its richer context. This avoids double error toasts. A failed block
 * count follows the same rule and stays in WYSIWYG.
 *
 * @coordinates-with stores/settingsStore.ts — reads `largeFile.autoSourceMode`
 *   and `largeFile.warnAbove5MB`.
 * @coordinates-with services/dialogs/largeFilePrompts.ts — native warn / refuse dialogs.
 * @coordinates-with utils/fileSizeThresholds.ts — byte and block classification.
 * @coordinates-with utils/dropPaths.ts — markdown-only applicability of the
 *   block estimate.
 * @module services/navigation/largeFileRouting
 */

import { invoke } from "@tauri-apps/api/core";
import {
  classifyFileSize,
  shouldSourceModeForBlocks,
  type FileSizeTier,
} from "@/utils/fileSizeThresholds";
import { confirmOpenHugeFile, showHugeFileRefusal } from "@/services/dialogs/largeFilePrompts";
import { useSettingsStore } from "@/stores/settingsStore";
import { isMarkdownFileName } from "@/utils/dropPaths";
import { largeFileWarn } from "@/utils/debug";

/** Return shape for the open-flow router. */
export interface LargeFileRoute {
  /** Caller must stop the open when false (user cancelled, or file refused). */
  proceed: boolean;
  /** Caller should setSourceMode(true) + markForcedSource(tabId) when true. */
  forceSourceMode: boolean;
  /** Raw size used for the routing decision; pass along for progress UI. */
  sizeBytes: number;
  /** Final tier after user interaction (unchanged from classification). */
  tier: FileSizeTier;
}

const DEFAULT_ROUTE: LargeFileRoute = {
  proceed: true,
  forceSourceMode: false,
  sizeBytes: 0,
  tier: "small",
};

/**
 * Pre-read routing decision for a file about to be opened. Always returns —
 * size-check errors fall through to the caller's normal read/error flow.
 */
export async function routeOpenBySize(path: string): Promise<LargeFileRoute> {
  let raw: unknown;
  try {
    raw = await Promise.resolve(invoke<unknown>("get_file_size_bytes", { path }));
  } catch (error) {
    largeFileWarn("size-check failed, continuing as small:", path, error);
    return DEFAULT_ROUTE;
  }

  // The command always returns a u64; defensive numeric narrowing keeps
  // mocked or misconfigured environments (non-numeric or `undefined` returns)
  // from crashing the open flow.
  const sizeBytes = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(sizeBytes)) return DEFAULT_ROUTE;

  const tier = classifyFileSize(sizeBytes);
  const { autoSourceMode, warnAbove5MB } = useSettingsStore.getState().largeFile;

  if (tier === "refused") {
    await showHugeFileRefusal(path, sizeBytes);
    return { proceed: false, forceSourceMode: false, sizeBytes, tier };
  }

  if (tier === "huge") {
    if (warnAbove5MB) {
      const confirmed = await confirmOpenHugeFile(path, sizeBytes);
      if (!confirmed) return { proceed: false, forceSourceMode: false, sizeBytes, tier };
    }
    // Huge always opens in Source mode — WYSIWYG is not offered at this tier.
    return { proceed: true, forceSourceMode: true, sizeBytes, tier };
  }

  if (tier === "large") {
    return {
      proceed: true,
      forceSourceMode: autoSourceMode,
      sizeBytes,
      tier,
    };
  }

  // "small" by bytes. Markdown is the one format whose WYSIWYG surface builds
  // a node per block, so a block-dense file can cost far more than its size
  // suggests. The estimate is a line scan in Rust — no markdown parse, which is
  // the work being avoided.
  if (autoSourceMode && isMarkdownFileName(path)) {
    const blockCount = await countMarkdownBlocks(path);
    if (shouldSourceModeForBlocks(blockCount)) {
      return { proceed: true, forceSourceMode: true, sizeBytes, tier };
    }
  }

  return { proceed: true, forceSourceMode: false, sizeBytes, tier };
}

/**
 * Best-effort block estimate. A rejection is "unknown", which stays in
 * WYSIWYG: the subsequent read reports a real failure with better context,
 * and a failed estimate must never silently change the user's editor mode.
 */
async function countMarkdownBlocks(path: string): Promise<number> {
  try {
    const raw = await Promise.resolve(invoke<unknown>("count_markdown_blocks", { path }));
    const blocks = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(blocks) ? blocks : 0;
  } catch (error) {
    largeFileWarn("block-count check failed, staying in WYSIWYG:", path, error);
    return 0;
  }
}
