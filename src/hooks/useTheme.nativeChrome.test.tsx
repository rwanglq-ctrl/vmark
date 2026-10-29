// useTheme reports the ACTIVE theme's chrome colors to the backend, so a
// Windows 11 title bar recolors with the theme (#1606). The boundary is the
// Tauri IPC; the theme catalog and the effective-theme resolution run for real.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "@/stores/settingsStore";
import { themes } from "@/theme/themes";
import { __resetNativeThemeCache } from "@/services/theme/nativeTheme";
import { useTheme } from "./useTheme";

const initialAppearance = useSettingsStore.getState().appearance;

function nativeThemeCalls(): unknown[] {
  return vi
    .mocked(invoke)
    .mock.calls.filter(([command]) => command === "set_native_theme")
    .map(([, args]) => args);
}

beforeEach(() => {
  vi.mocked(invoke).mockClear();
  __resetNativeThemeCache();
});

afterEach(() => {
  act(() => {
    useSettingsStore.setState({ appearance: initialAppearance });
  });
});

describe("useTheme → native chrome", () => {
  it("sends the active theme's polarity and chrome colors", async () => {
    act(() => {
      useSettingsStore.setState({
        appearance: { ...initialAppearance, theme: "sepia", followSystemAppearance: false },
      });
    });
    renderHook(() => useTheme());

    await vi.waitFor(() => expect(nativeThemeCalls()).not.toHaveLength(0));
    const sepia = themes.sepia.color;
    expect(nativeThemeCalls().at(-1)).toEqual({
      dark: false,
      chrome: { caption: sepia.bg.primary, text: sepia.text.primary, border: sepia.border },
    });
  });

  it("re-reports when the theme changes within the same polarity", async () => {
    act(() => {
      useSettingsStore.setState({
        appearance: { ...initialAppearance, theme: "sepia", followSystemAppearance: false },
      });
    });
    renderHook(() => useTheme());
    await vi.waitFor(() => expect(nativeThemeCalls()).toHaveLength(1));

    act(() => {
      useSettingsStore.setState({
        appearance: { ...useSettingsStore.getState().appearance, theme: "mint" },
      });
    });

    await vi.waitFor(() => expect(nativeThemeCalls()).toHaveLength(2));
    expect(nativeThemeCalls().at(-1)).toMatchObject({
      dark: false,
      chrome: { caption: themes.mint.color.bg.primary },
    });
  });
});
