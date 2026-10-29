// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
const platform = vi.hoisted(() => ({ isMac: false }));
vi.mock("@/utils/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/platform")>()),
  isMacPlatform: () => platform.isMac,
}));

import {
  __resetNativeThemeCapability,
  loadNativeThemeCapability,
  offersFullThemeCatalog,
} from "./nativeThemeCapability";

beforeEach(() => {
  invokeMock.mockReset();
  platform.isMac = false;
  __resetNativeThemeCapability();
});

describe("offersFullThemeCatalog", () => {
  it("is true on macOS without asking the backend", () => {
    platform.isMac = true;
    expect(offersFullThemeCatalog()).toBe(true);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  // Before the backend has answered (or where it never does), a non-macOS
  // window must render the narrowed pair: that is what it could always draw.
  it("is false off macOS until the backend has reported", () => {
    expect(offersFullThemeCatalog()).toBe(false);
  });

  it("is true off macOS once the backend reports a themable caption (Windows 11)", async () => {
    invokeMock.mockResolvedValue({ themedCaption: true });
    await loadNativeThemeCapability();
    expect(invokeMock).toHaveBeenCalledWith("native_theme_capabilities");
    expect(offersFullThemeCatalog()).toBe(true);
  });

  it("stays false when the backend reports no themable caption (Windows 10, Linux)", async () => {
    invokeMock.mockResolvedValue({ themedCaption: false });
    await loadNativeThemeCapability();
    expect(offersFullThemeCatalog()).toBe(false);
  });
});

describe("loadNativeThemeCapability", () => {
  // It runs in bootstrap ahead of first paint; a rejection there would keep
  // the app from mounting at all, for a cosmetic capability.
  it("never rejects, and falls back to the narrowed pair, when the command fails", async () => {
    invokeMock.mockRejectedValue(new Error("no such command"));
    await expect(loadNativeThemeCapability()).resolves.toBeUndefined();
    expect(offersFullThemeCatalog()).toBe(false);
  });

  // Zero trust at the boundary: only a real boolean `true` widens the catalog.
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a string", "true"],
    ["a truthy non-boolean field", { themedCaption: 1 }],
    ["a string field", { themedCaption: "true" }],
    ["a missing field", {}],
  ])("treats %s as no capability", async (_label, payload) => {
    invokeMock.mockResolvedValue(payload);
    await loadNativeThemeCapability();
    expect(offersFullThemeCatalog()).toBe(false);
  });

  it("is idempotent across repeated loads", async () => {
    invokeMock.mockResolvedValue({ themedCaption: true });
    await loadNativeThemeCapability();
    await loadNativeThemeCapability();
    expect(offersFullThemeCatalog()).toBe(true);
  });
});
