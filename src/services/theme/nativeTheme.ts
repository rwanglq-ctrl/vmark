/**
 * Native chrome theming bridge.
 *
 * Purpose: VMark paints its own UI from CSS tokens, but the window title bar
 * and (on Windows) the menu bar are drawn by the OS and ignore that. This
 * reports the resolved light/dark state, and the theme's chrome colors
 * (`theme/nativeChrome.ts`), to Rust so the native chrome can follow it — by
 * polarity everywhere, and by color where DWM allows it (Windows 11).
 *
 * Key decisions:
 *   - Platform handling lives in Rust (`window_manager/native_theme.rs`), not
 *     here, so there is one place that decides what each OS does. macOS is a
 *     deliberate no-op there, and the colors are ignored where the caption
 *     cannot take them. They are sent on every platform anyway, so this module
 *     has no platform branch of its own.
 *   - Failures are swallowed. This runs from useTheme's effect *after* the CSS
 *     theme is already applied; a missing command or non-Tauri context must
 *     not break theming of the app's own UI.
 *
 * @coordinates-with window_manager/native_theme.rs — the `set_native_theme` command
 * @coordinates-with hooks/useTheme.ts — sole caller
 * @coordinates-with theme/nativeChrome.ts — the color payload
 * @module services/theme/nativeTheme
 */

import { invoke } from "@tauri-apps/api/core";
import { getOmarchyAppearance } from "@/theme/omarchyAppearance";
import type { NativeChromeColors } from "@/theme/nativeChrome";

/**
 * Last payload the backend actually accepted, as a comparable key. `null`
 * means "nothing delivered yet", so the first report always goes out.
 */
let lastDelivered: string | null = null;

/** One string per distinct payload, so equal colors in a new object compare equal. */
function payloadKey(params: Record<string, unknown>): string {
  return JSON.stringify(params);
}

/**
 * Report the resolved theme so native window chrome can match it.
 *
 * Cheap to call repeatedly: useTheme's effect re-runs on any theme-affecting
 * settings change (font size, line height…), and only an actual change of
 * polarity or chrome color reaches the backend.
 */
export async function syncNativeTheme(
  isDark: boolean,
  chrome: NativeChromeColors,
): Promise<void> {
  const system = getOmarchyAppearance();
  const color = system?.theme.color;
  const params: Record<string, unknown> = {
    dark: isDark,
    chrome,
    ...(color
      ? {
          appearance: {
            background: color.bg.primary,
            foreground: color.text.primary,
            selection: color.selection,
            border: color.border,
          },
        }
      : {}),
  };
  const key = payloadKey(params);
  if (lastDelivered === key) return;

  try {
    await invoke("set_native_theme", params);
    // Recorded only on success, so a transient failure is retried on the next
    // theme change rather than being remembered as delivered.
    lastDelivered = key;
  } catch {
    // Intentionally silent — see the header.
  }
}

/** Test seam: clear the delivered-state cache between cases. */
export function __resetNativeThemeCache(): void {
  lastDelivered = null;
}
