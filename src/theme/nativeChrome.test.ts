// @vitest-environment node
import { describe, expect, it } from "vitest";
import { themes } from "./themes";
import type { ThemeId } from "./themes";
import { nativeChromeColors } from "./nativeChrome";

const ALL_IDS = Object.keys(themes) as ThemeId[];

describe("nativeChromeColors", () => {
  // The title bar sits directly above the shell, which paints --bg-color
  // (bg.primary). Reusing the catalog's own tokens is the whole design: no
  // chrome color is authored separately, so a retinted theme cannot drift.
  it.each(ALL_IDS)("takes %s's caption, text and border from its tokens", (id) => {
    const { color } = themes[id];
    expect(nativeChromeColors(themes[id])).toEqual({
      caption: color.bg.primary,
      text: color.text.primary,
      border: color.border,
    });
  });

  // `set_native_theme` parses exactly `#RRGGBB` (DWM takes an opaque
  // COLORREF and has no alpha), and refuses anything else. A theme authored
  // with rgba() or a named color here would be rejected at the IPC boundary,
  // so the catalog is held to the format the backend accepts.
  it.each(ALL_IDS)("gives %s colors in the #RRGGBB form the backend parses", (id) => {
    for (const value of Object.values(nativeChromeColors(themes[id]))) {
      expect(value).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("returns a fresh object each call, so a caller cannot mutate a theme", () => {
    const first = nativeChromeColors(themes.sepia);
    first.caption = "#000000";
    expect(nativeChromeColors(themes.sepia).caption).toBe(themes.sepia.color.bg.primary);
  });
});
