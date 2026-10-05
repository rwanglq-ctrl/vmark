// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { syncNativeTheme, __resetNativeThemeCache } from "./nativeTheme";
import { buildOmarchyAppearance, setOmarchyAppearance } from "@/theme/omarchyAppearance";

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
    await syncNativeTheme(true);
    expect(invokeMock).toHaveBeenCalledWith("set_native_theme", { dark: true });
  });

  it("reports a light theme to the backend", async () => {
    await syncNativeTheme(false);
    expect(invokeMock).toHaveBeenCalledWith("set_native_theme", { dark: false });
  });

  it("skips a repeated report of the same theme", async () => {
    await syncNativeTheme(true);
    await syncNativeTheme(true);
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("reports again when the theme actually flips", async () => {
    await syncNativeTheme(true);
    await syncNativeTheme(false);
    await syncNativeTheme(true);
    expect(invokeMock).toHaveBeenCalledTimes(3);
    expect(invokeMock).toHaveBeenLastCalledWith("set_native_theme", { dark: true });
  });

  // useTheme runs this inside a layout effect on every theme-affecting
  // settings change. A rejected invoke (non-Tauri context, command missing on
  // an older shell) must not surface as an unhandled rejection that takes the
  // theme effect down with it — the CSS theme has already been applied by then.
  it("swallows backend failures", async () => {
    invokeMock.mockRejectedValue(new Error("no such command"));
    await expect(syncNativeTheme(true)).resolves.toBeUndefined();
  });

  // A failed report must not be recorded as the delivered state, or the app
  // would stay permanently out of sync after one transient error.
  it("retries after a failure instead of caching it", async () => {
    invokeMock.mockRejectedValueOnce(new Error("transient"));
    await syncNativeTheme(true);
    expect(invokeMock).toHaveBeenCalledTimes(1);

    invokeMock.mockResolvedValue(undefined);
    await syncNativeTheme(true);
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });
});
