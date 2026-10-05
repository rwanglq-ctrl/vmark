// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startOmarchyReader } from "./omarchyReader";
import { getOmarchyAppearance, setOmarchyAppearance } from "@/theme/omarchyAppearance";

const mock = vi.hoisted(() => ({ invoke: vi.fn(), fetch: vi.fn(), state: {
  appearance: { followSystemAppearance: true } as Record<string, unknown>,
  terminal: {} as Record<string, unknown>,
  updateAppearanceSetting: vi.fn(), updateTerminalSetting: vi.fn(),
} }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mock.invoke, convertFileSrc: (p: string) => p }));
vi.mock("@tauri-apps/api/path", () => ({ homeDir: async () => "/home/test/" }));
vi.mock("@/stores/settingsStore", () => ({ useSettingsStore: { getState: () => mock.state } }));

const colors = 'mode="dark"\nbackground="#0B1220"\nforeground="#E2E8F0"\naccent="#8FB8F0"\nselection="#1B2C4E"\nmuted="#566378"';
let stop: (() => void) | undefined;
async function settle() { for (let n = 0; n < 12; n++) await Promise.resolve(); }
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mock.state.appearance = { followSystemAppearance: true };
  mock.state.terminal = {};
  mock.invoke.mockResolvedValue({ family: "Sans", points: 14 });
  mock.fetch.mockImplementation(async (url: string) => ({ ok: true, text: async () => url.includes("colors.toml") ? colors : "font=JetBrainsMono Nerd Font:size=14" }));
  vi.stubGlobal("fetch", mock.fetch);
});
afterEach(() => {
  stop?.(); stop = undefined;
  setOmarchyAppearance(null);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("system appearance reader lifecycle", () => {
  it("publishes one complete profile and preserves it through permission or read failures", async () => {
    stop = startOmarchyReader(); await settle();
    const previous = getOmarchyAppearance();
    expect(previous?.uiSize).toBeCloseTo(18.6667, 3);
    expect(mock.state.updateTerminalSetting).toHaveBeenCalledWith("minimumContrastRatio", 1);
    mock.fetch.mockResolvedValue({ ok: false });
    await vi.advanceTimersByTimeAsync(3000);
    expect(getOmarchyAppearance()).toBe(previous);
    expect(mock.invoke).toHaveBeenCalledTimes(1);
  });
  it("discards delayed native responses after teardown and stops polling", async () => {
    let finish!: (font: { family: string; points: number }) => void;
    mock.invoke.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    stop = startOmarchyReader(); await settle();
    stop(); stop = undefined;
    finish({ family: "霞鹜文楷", points: 18 }); await settle();
    expect(getOmarchyAppearance()).toBeNull();
    expect(mock.state.updateAppearanceSetting).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(9000);
    expect(mock.fetch).toHaveBeenCalledTimes(2);
  });
  it("does not overwrite manual preferences if follow-system is disabled while files load", async () => {
    stop = startOmarchyReader();
    mock.state.appearance.followSystemAppearance = false;
    await settle();
    expect(mock.invoke).not.toHaveBeenCalled();
    expect(getOmarchyAppearance()).toBeNull();
    expect(mock.state.updateAppearanceSetting).not.toHaveBeenCalled();
  });
});
