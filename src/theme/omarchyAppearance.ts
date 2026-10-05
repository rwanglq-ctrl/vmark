/**
 * Omarchy appearance data shared by CSS, xterm and native chrome.
 * Built-in themes remain immutable; catalog access resolves this optional
 * system snapshot only while the Linux appearance reader enables it.
 * @module theme/omarchyAppearance
 */
import type { ThemeTokens } from "./tokens";
import { night } from "./themes/night";
import { white } from "./themes/white";
import { sanitizeCustomFontFamily } from "@/utils/customFont";

export interface SystemGuiFont { family: string; points: number }
export interface OmarchyAppearance {
  theme: ThemeTokens;
  uiFont: string;
  uiSize: number;
  monoFont: string;
  monoSize: number;
  terminalLineHeight: number;
  cursorBlink: boolean;
  cursorStyle: "block" | "bar" | "underline";
}
let appearance: OmarchyAppearance | null = null;
let signature = "null";
const listeners = new Set<() => void>();
export const getOmarchyAppearance = () => appearance;
export function subscribeOmarchyAppearance(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function setOmarchyAppearance(value: OmarchyAppearance | null) {
  const next = JSON.stringify(value);
  if (next === signature) return;
  signature = next;
  appearance = value;
  for (const listener of listeners) listener();
}
export function omarchyThemeFor(dark: boolean, fallback: ThemeTokens): ThemeTokens {
  return appearance?.theme.isDark === dark ? appearance.theme : fallback;
}

const pointsToPixels = (value: number) => (Number.isFinite(value) && value >= 6 && value <= 48 ? value : 14) * 96 / 72;
/** Validate palette input before constructing any CSS or terminal options. */
export function buildOmarchyAppearance(toml: string, foot: string, gui: SystemGuiFont): OmarchyAppearance {
  const c = Object.fromEntries([...toml.matchAll(/^\s*(\w+)\s*=\s*"(#[\da-fA-F]{6})"/gm)].map(m => [m[1], m[2]]));
  for (const key of ["background", "foreground", "accent", "selection", "muted"]) {
    if (!c[key]) throw new Error(`Missing Omarchy color: ${key}`);
  }
  const dark = !/^\s*mode\s*=\s*"light"/m.test(toml);
  const theme = structuredClone(dark ? night : white);
  const color = theme.color;
  color.bg = { primary: c.background, secondary: c.dark_background ?? c.background, tertiary: c.lighter_background ?? c.selection };
  color.text = { primary: c.foreground, secondary: c.light_foreground ?? c.foreground, tertiary: c.dark_foreground ?? c.muted };
  color.accent = { primary: c.accent, bg: c.selection };
  color.border = c.lighter_background ?? c.selection;
  color.controlBorder = c.muted;
  color.contrastText = c.background;
  color.selection = c.selection;
  color.strong = c.bright_blue ?? c.accent;
  color.emphasis = c.orange ?? c.accent;
  color.quoteText = color.text.secondary;
  color.semantic.error = c.red ?? color.semantic.error;
  color.semantic.errorHover = c.bright_red ?? color.semantic.error;
  color.semantic.success = c.green ?? color.semantic.success;
  color.semantic.successHover = c.bright_green ?? color.semantic.success;
  color.semantic.warning = c.yellow ?? color.semantic.warning;
  const tint = (ink: string, percent: number) => `color-mix(in srgb, ${ink} ${percent}%, transparent)`;
  color.semantic.errorBg = tint(color.semantic.error, 12);
  color.semantic.warningBg = tint(color.semantic.warning, 12);
  color.semantic.warningBorder = tint(color.semantic.warning, 30);
  color.subtle = { bg: tint(c.foreground, 3), bgHover: tint(c.foreground, 5) };
  color.hover = { bg: tint(c.foreground, 8), strong: tint(c.foreground, 12) };
  color.alert = { note: c.blue ?? c.accent, tip: c.green ?? c.accent, important: c.magenta ?? c.accent, warning: c.yellow ?? c.accent, caution: c.red ?? c.accent };
  color.legacy = { ...color.legacy, codeText: c.foreground, mdChar: color.text.tertiary, blurText: color.text.tertiary, accentBg: c.selection, sourceModeBg: c.background, errorColorHover: color.semantic.errorHover, successColorHover: color.semantic.successHover, highlightBg: c.selection, highlightText: c.foreground, blockBgSubtle: color.subtle.bg, blockBgSubtleHover: color.subtle.bgHover };
  const ansi = theme.terminal.ansi;
  Object.assign(ansi, {
    black: c.background, red: c.red ?? ansi.red, green: c.green ?? ansi.green,
    yellow: c.yellow ?? ansi.yellow, blue: c.blue ?? c.accent, magenta: c.magenta ?? ansi.magenta,
    cyan: c.cyan ?? ansi.cyan, white: c.foreground, brightBlack: c.muted,
    brightRed: c.bright_red ?? c.red ?? ansi.brightRed,
    brightGreen: c.bright_green ?? c.green ?? ansi.brightGreen,
    brightYellow: c.bright_yellow ?? c.yellow ?? ansi.brightYellow,
    brightBlue: c.bright_blue ?? c.blue ?? c.accent,
    brightMagenta: c.bright_magenta ?? c.magenta ?? ansi.brightMagenta,
    brightCyan: c.bright_cyan ?? c.cyan ?? ansi.brightCyan,
    brightWhite: c.bright_foreground ?? c.foreground,
  });
  theme.terminal.cursor = c.foreground;
  theme.terminal.cursorAccent = c.background;
  theme.terminal.boldTextInBrightColors = true;
  const syntax = { keyword: "magenta", type: "cyan", function: "blue", property: "cyan", variable: "foreground", string: "green", number: "orange", operator: "foreground", punctuation: "light_foreground", comment: "dark_foreground", escape: "yellow", constant: "orange", attribute: "cyan", tag: "red", link: "blue", invalid: "red" } as const;
  for (const [role, key] of Object.entries(syntax)) {
    if (c[key]) theme.syntax[role as keyof typeof theme.syntax] = c[key];
  }
  const font = foot.match(/^\s*font\s*=\s*([^:\n]+)([^\n]*)/m);
  const size = font?.[2].match(/:size=([\d.]+)/)?.[1];
  const cursor = foot.match(/^\s*style\s*=\s*(block|bar|underline)\s*$/m)?.[1];
  return {
    theme, uiFont: sanitizeCustomFontFamily(gui.family) ?? "Sans", uiSize: pointsToPixels(gui.points),
    monoFont: sanitizeCustomFontFamily(font?.[1] ?? "") ?? "JetBrainsMono Nerd Font",
    monoSize: pointsToPixels(size ? Number(size) : 14), terminalLineHeight: 1,
    cursorBlink: /^\s*blink\s*=\s*(yes|true)\s*$/m.test(foot),
    cursorStyle: cursor as OmarchyAppearance["cursorStyle"] ?? "block",
  };
}
