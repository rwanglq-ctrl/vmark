// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { buildOmarchyAppearance, getOmarchyAppearance, setOmarchyAppearance, subscribeOmarchyAppearance } from "./omarchyAppearance";
import { themes } from "./themes";
import { themesAsColors } from "./themeColorsAdapter";
import { buildXtermThemeForId } from "./buildXtermTheme";

const colors = `mode = "dark"\nbackground = "#0B1220"\nforeground = "#E2E8F0"\naccent = "#8FB8F0"\nselection = "#1B2C4E"\nmuted = "#566378"\nred = "#EE6A64"\nbright_blue = "#B3CFF5"`;
const foot = "[main]\nfont=JetBrainsMono Nerd Font:size=14\n[cursor]\nstyle=block\nblink=no";
afterEach(() => setOmarchyAppearance(null));

describe("Omarchy full application appearance", () => {
  it("converts system point sizes and uses separate GUI and terminal fonts", () => {
    const p = buildOmarchyAppearance(colors, foot, { family: "Sans", points: 14 });
    expect(p.uiSize).toBeCloseTo(18.6667, 3);
    expect(p.monoSize).toBeCloseTo(18.6667, 3);
    expect(p.uiFont).toBe("Sans");
    expect(p.monoFont).toBe("JetBrainsMono Nerd Font");
    expect(p.terminalLineHeight).toBe(1);
    expect(p.cursorBlink).toBe(false);
  });
  it("supplies the same exact palette to typed themes, legacy styles and xterm", () => {
    const original = themes.night;
    setOmarchyAppearance(buildOmarchyAppearance(colors, foot, { family: "Sans", points: 14 }));
    expect(themes.night.color.bg.primary).toBe("#0B1220");
    expect(themesAsColors.night.background).toBe("#0B1220");
    const terminal = buildXtermThemeForId("night");
    expect(terminal.background).toBe("#0B1220");
    expect(terminal.red).toBe("#EE6A64");
    expect(terminal.brightBlue).toBe("#B3CFF5");
    expect(terminal.selectionBackground).toBe("#1B2C4E");
    expect(original.color.bg.primary).toBe("#23262b");
    setOmarchyAppearance(null);
    expect(themes.night).toBe(original);
  });
  it("notifies once per changed profile and supports live light/dark switches", () => {
    let calls = 0;
    const unsubscribe = subscribeOmarchyAppearance(() => calls++);
    const p = buildOmarchyAppearance(colors, foot, { family: "Sans", points: 14 });
    setOmarchyAppearance(p); setOmarchyAppearance(p);
    expect(calls).toBe(1);
    setOmarchyAppearance(buildOmarchyAppearance(colors.replace('"dark"', '"light"'), foot, { family: "Sans", points: 14 }));
    expect(themes.white.isDark).toBe(false);
    expect(themes.white.color.bg.primary).toBe("#0B1220");
    expect(calls).toBe(2);
    unsubscribe();
  });
  it.each(["", 'background="bad"', colors.replace("#0B1220", "url(invalid)")])("rejects invalid palettes and leaves the active profile unchanged", text => {
    expect(() => buildOmarchyAppearance(text, foot, { family: "Sans", points: 14 })).toThrow();
    expect(getOmarchyAppearance()).toBeNull();
  });
  it("handles missing font configuration, fractional sizes and CJK family names", () => {
    const p = buildOmarchyAppearance(colors, "font=霞鹜文楷等宽:size=13.5", { family: "Noto Sans CJK SC", points: 13.5 });
    expect(p.monoSize).toBe(18);
    expect(p.monoFont).toBe("霞鹜文楷等宽");
    expect(buildOmarchyAppearance(colors, "", { family: "", points: NaN }).uiSize).toBeCloseTo(18.6667, 3);
  });
});
