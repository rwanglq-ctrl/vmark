/**
 * Native theme capability — whether this window's OS chrome can follow every
 * theme in the catalog, or only light/dark.
 *
 * Purpose: the theme picker and the effective-theme resolution must agree on
 * one answer (`theme/themeAvailability.ts`). macOS always can (overlay title
 * bar). Off macOS the backend decides: Windows 11 colors the title bar through
 * DWM, Windows 10 and Linux cannot (`window_manager/native_theme.rs`,
 * `native_theme_capabilities`).
 *
 * Pipeline: `bootstrap` awaits `loadNativeThemeCapability()` alongside the
 * secure-storage IPCs, before App mounts → the answer is cached here → the
 * first render already resolves the user's theme, so a Windows 11 window does
 * not paint White and then switch to Sepia.
 *
 * Key decisions:
 *   - A plain module value, not a store: it is an OS fact that is fixed for
 *     the life of the process and is set before any component reads it, so
 *     nothing ever needs to re-render on a change.
 *   - Fails closed: an absent command, a rejected invoke or a malformed reply
 *     all mean "light/dark only" — the behavior every non-macOS build had.
 *   - macOS is answered locally, so the primary platform never depends on the
 *     IPC for its theme catalog.
 *
 * @coordinates-with window_manager/native_theme.rs — `native_theme_capabilities`
 * @coordinates-with bootstrap.tsx — loads it before first paint
 * @coordinates-with theme/themeAvailability.ts — consumes the answer
 * @module services/theme/nativeThemeCapability
 */

import { invoke } from "@tauri-apps/api/core";
import { isMacPlatform } from "@/utils/platform";

/** Whether the backend reported a caption it can color per theme. */
let themedCaption = false;

/** True only for the exact shape the backend sends: `{ themedCaption: true }`. */
function reportsThemedCaption(reply: unknown): boolean {
  return (
    typeof reply === "object" &&
    reply !== null &&
    (reply as { themedCaption?: unknown }).themedCaption === true
  );
}

/**
 * Ask the backend once whether the native caption can follow every theme.
 * Never rejects: it runs ahead of first paint, and a failure only means the
 * narrowed light/dark catalog.
 */
export async function loadNativeThemeCapability(): Promise<void> {
  try {
    themedCaption = reportsThemedCaption(await invoke("native_theme_capabilities"));
  } catch {
    themedCaption = false;
  }
}

/** Whether this window may offer and render the full theme catalog. */
export function offersFullThemeCatalog(): boolean {
  return isMacPlatform() || themedCaption;
}

/** Test seam: forget the backend's answer. */
export function __resetNativeThemeCapability(): void {
  themedCaption = false;
}
