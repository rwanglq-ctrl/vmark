/**
 * Which themes a platform can actually offer.
 *
 * Purpose: where the OS draws the title bar and only accepts "light" or
 * "dark" for it — Windows 10 and Linux — a sepia or mint theme has no matching
 * chrome at any price, so the window would always be half-themed. Those
 * platforms are limited to one light theme and one dark theme, each of which
 * maps exactly onto what the OS can render.
 *
 * The full catalog is offered where the chrome can follow every theme: macOS
 * (overlay title bar, menus in the system bar) and Windows 11, whose DWM takes
 * an explicit caption color (`window_manager/native_theme.rs`). Which case a
 * window is in is decided by `services/theme/nativeThemeCapability.ts`; this
 * module only takes the answer.
 *
 * Key decisions:
 *   - Coercion preserves *polarity*. Someone who chose sepia (light) and moves
 *     to Windows 10 gets white, not night — settings sync between machines must
 *     not flip a user from light to dark.
 *   - Pure and platform-agnostic: callers pass `fullCatalog`, so this stays
 *     testable without stubbing `navigator` or the IPC.
 *   - `selectableThemeIds` and `coerceThemeId` take the SAME flag. A picker
 *     that offers a theme the renderer then coerces away shows swatches that
 *     render as White/Night.
 *
 * @coordinates-with services/theme/nativeThemeCapability.ts — decides `fullCatalog`
 * @coordinates-with hooks/useEffectiveTheme.ts — coerces the resolved theme
 * @coordinates-with pages/settings/AppearanceSettings.tsx — filters the swatches
 * @module theme/themeAvailability
 */

import { themes } from "./themes";
import type { ThemeId } from "./themes";

/**
 * The neutral light/dark pair: what platforms without themable chrome offer,
 * and what `neutralThemeId` maps every theme onto.
 */
export const NEUTRAL_THEME_IDS: readonly ThemeId[] = Object.freeze([
  "white",
  "night",
] as ThemeId[]);

/** Themes the theme picker should offer, given whether the full catalog renders here. */
export function selectableThemeIds(fullCatalog: boolean): ThemeId[] {
  // Copies both branches so a caller mutating the result cannot corrupt the
  // frozen constant or the catalog's key order.
  return fullCatalog ? (Object.keys(themes) as ThemeId[]) : [...NEUTRAL_THEME_IDS];
}

/**
 * Map a stored theme onto one this platform can render.
 *
 * Unknown ids fall back to white rather than throwing: corrupted persisted
 * settings are a real case, and the theme layer already treats them as
 * recoverable.
 */
export function coerceThemeId(id: ThemeId, fullCatalog: boolean): ThemeId {
  if (fullCatalog) return id;
  if (NEUTRAL_THEME_IDS.includes(id)) return id;
  return neutralThemeId(id);
}

/**
 * The neutral counterpart of a theme, by polarity: `white` for a light theme,
 * `night` for a dark one.
 *
 * Two callers want this for different reasons — platform coercion above, and the
 * browser-chrome neutral in `terminalThemeForBrowser.ts` — and they had it
 * written out twice. The mapping and the pair are the same fact either way, so
 * it lives here once, beside `NEUTRAL_THEME_IDS` which is that same pair.
 *
 * An unknown id resolves to the light neutral rather than throwing: corrupted
 * persisted settings are a real case, and `themes[id]?.isDark` is also what makes
 * `"__proto__"` land on the fallback instead of reaching `Object.prototype`.
 */
export function neutralThemeId(id: ThemeId): ThemeId {
  return themes[id]?.isDark ? "night" : "white";
}
