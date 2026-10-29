// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { syncNativeTheme, __resetNativeThemeCache } from "./nativeTheme";
import { buildOmarchyAppearance, setOmarchyAppearance } from "@/theme/omarchyAppearance";

const SEPIA = { caption: "#F9F0DB", text: "#5c4b37", border: "#e0d5bc" };
const WHITE = { caption: "#FFFFFF", text: "#1a1a1a", border: "#eeeeee" };
const NIGHT = { caption: "#23262b", text: "#d6d9de", border: "#3a3f46" };

beforeEach(() => {
  setOmarchyAppearance(null);
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
  __resetNativeThemeCache();
});

describe("syncNativeTheme", () => {
  it("delivers a changed palette and removes it when following the system is disabled", async () => {
    const colors = 'background="#0B1220"\nforeground="#E2E8F0"\naccent="#8FB8F0"\nselection="#1B2C4E"\nmuted="#566378"';
    setOmarchyAppearance(buildOmarchyAppearance(colors, "", { family: "Sans", points: 14 }));
    await syncNativeTheme(true);
    expect(invokeMock.mock.calls[0]?.[1]).toMatchObject({ appearance: { background: "#0B1220" } });
    setOmarchyAppearance(buildOmarchyAppearance(colors.replace("#0B1220", "#070C15"), "", { family: "Sans", points: 14 }));
    await syncNativeTheme(true);
    setOmarchyAppearance(null);
    await syncNativeTheme(true);
    expect(invokeMock).toHaveBeenCalledTimes(3);
    expect(invokeMock).toHaveBeenLastCalledWith("set_native_theme", { dark: true });
  });
  it("reports a dark theme to the backend", async () => {
    await syncNativeTheme(true, NIGHT);
    expect(invokeMock).toHaveBeenCalledWith("set_native_theme", { dark: true, chrome: NIGHT });
  });

  it("reports a light theme to the backend", async () => {
    await syncNativeTheme(false, WHITE);
    expect(invokeMock).toHaveBeenCalledWith("set_native_theme", { dark: false, chrome: WHITE });
  });

  it("skips a repeated report of the same theme", async () => {
    await syncNativeTheme(true, NIGHT);
    await syncNativeTheme(true, NIGHT);
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("reports again when the theme actually flips", async () => {
    await syncNativeTheme(true, NIGHT);
    await syncNativeTheme(false, WHITE);
    await syncNativeTheme(true, NIGHT);
    expect(invokeMock).toHaveBeenCalledTimes(3);
    expect(invokeMock).toHaveBeenLastCalledWith("set_native_theme", { dark: true, chrome: NIGHT });
  });

  // White and Sepia are both light: a polarity-only dedupe would never tell
  // Windows 11 to recolor the caption when the user moves between them.
  it("reports again when only the chrome colors change", async () => {
    await syncNativeTheme(false, WHITE);
    await syncNativeTheme(false, SEPIA);
    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(invokeMock).toHaveBeenLastCalledWith("set_native_theme", { dark: false, chrome: SEPIA });
  });

  it("skips a repeat of equal colors passed as a new object", async () => {
    await syncNativeTheme(false, { ...SEPIA });
    await syncNativeTheme(false, { ...SEPIA });
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  // useTheme runs this inside a layout effect on every theme-affecting
  // settings change. A rejected invoke (non-Tauri context, command missing on
  // an older shell) must not surface as an unhandled rejection that takes the
  // theme effect down with it — the CSS theme has already been applied by then.
  it("swallows backend failures", async () => {
    invokeMock.mockRejectedValue(new Error("no such command"));
    await expect(syncNativeTheme(true, NIGHT)).resolves.toBeUndefined();
  });

  // A failed report must not be recorded as the delivered state, or the app
  // would stay permanently out of sync after one transient error.
  it("retries after a failure instead of caching it", async () => {
    invokeMock.mockRejectedValueOnce(new Error("transient"));
    await syncNativeTheme(true, NIGHT);
    expect(invokeMock).toHaveBeenCalledTimes(1);

    invokeMock.mockResolvedValue(undefined);
    await syncNativeTheme(true, NIGHT);
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });
});
