/**
 * Native chrome colors — which of a theme's own tokens the OS-drawn title bar
 * should wear, where the OS lets an app color it (Windows 11's DWM).
 *
 * Key decisions:
 *   - No color is authored here. The caption is `bg.primary` because that is
 *     what the shell paints directly beneath the title bar (`--bg-color`); the
 *     caption text is `text.primary` and the window border is the divider
 *     `border`. A retinted theme therefore retints its chrome for free.
 *   - Pure: the backend (`window_manager/native_theme.rs`) decides whether a
 *     platform can use the colors; this only says what they are.
 *
 * @coordinates-with services/theme/nativeTheme.ts — sends these to the backend
 * @coordinates-with hooks/useTheme.ts — computes them for the active theme
 * @module theme/nativeChrome
 */

import type { ThemeTokens } from "./tokens";

/** The three DWM chrome colors, each a `#RRGGBB` string from the theme catalog. */
export interface NativeChromeColors {
  caption: string;
  text: string;
  border: string;
}

/** The chrome colors for `tokens`, as a fresh object. */
export function nativeChromeColors(tokens: ThemeTokens): NativeChromeColors {
  return {
    caption: tokens.color.bg.primary,
    text: tokens.color.text.primary,
    border: tokens.color.border,
  };
}
