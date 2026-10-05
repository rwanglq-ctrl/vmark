import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Terminal } from "@xterm/xterm";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { createTerminalKeyHandler } from "./terminalKeyHandler";

vi.mock("@/services/terminal/terminalGate", () => ({
  requestToggleTerminal: vi.fn(), toggleTerminalFocus: vi.fn(),
}));

function event(key: string, shiftKey = false, ctrlKey = true) {
  return new KeyboardEvent("keydown", { key, ctrlKey, shiftKey, cancelable: true });
}
function harness(selection = false) {
  const term = {
    hasSelection: () => selection, getSelection: () => "selected",
    clearSelection: vi.fn(), clear: vi.fn(), selectAll: vi.fn(), paste: vi.fn(),
  };
  const onSearch = vi.fn();
  const handler = createTerminalKeyHandler(term as unknown as Terminal, { current: null }, {
    onSearch, isComposing: () => false,
  });
  return { term, onSearch, handler };
}
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("navigator", { platform: "Linux aarch64" }); });
afterEach(() => vi.unstubAllGlobals());

describe("Linux terminal control keys", () => {
  it.each(["a", "b", "d", "e", "f", "k", "l", "r", "u", "w", "z"])(
    "passes Ctrl+%s through to readline/foreground programs even with a selection",
    (key) => {
      const { handler, term, onSearch } = harness(true);
      const e = event(key);
      expect(handler(e)).toBe(true);
      expect(e.defaultPrevented).toBe(false);
      expect(term.selectAll).not.toHaveBeenCalled();
      expect(term.clear).not.toHaveBeenCalled();
      expect(onSearch).not.toHaveBeenCalled();
      expect(readText).not.toHaveBeenCalled();
      expect(writeText).not.toHaveBeenCalled();
    },
  );
  it("passes Ctrl+C through as SIGINT when nothing is selected", () => {
    const { handler } = harness();
    const e = event("c");
    expect(handler(e)).toBe(true);
    expect(e.defaultPrevented).toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });
});

describe("Linux terminal clipboard keys follow Omarchy", () => {
  // Omarchy's Super+C / Super+V reach a non-terminal window as Ctrl+C / Ctrl+V.
  it("copies a selection with Ctrl+C (Omarchy Super+C)", () => {
    const { handler, term } = harness(true);
    const e = event("c");
    expect(handler(e)).toBe(false);
    expect(e.defaultPrevented).toBe(true);
    expect(writeText).toHaveBeenCalledWith("selected");
    expect(term.clearSelection).toHaveBeenCalledOnce();
  });
  it("pastes with Ctrl+V (Omarchy Super+V) through xterm's bracketed-paste path", async () => {
    vi.mocked(readText).mockResolvedValue("你好\nworld");
    const { handler, term } = harness();
    const e = event("v");
    expect(handler(e)).toBe(false);
    expect(e.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(term.paste).toHaveBeenCalledWith("你好\nworld"));
  });
  it("copies a selection with Ctrl+Insert like Omarchy's terminals", () => {
    const { handler } = harness(true);
    const e = event("Insert");
    expect(handler(e)).toBe(false);
    expect(e.defaultPrevented).toBe(true);
    expect(writeText).toHaveBeenCalledWith("selected");
  });
  it("consumes Ctrl+Insert without a selection instead of sending an escape sequence", () => {
    const { handler } = harness();
    const e = event("Insert");
    expect(handler(e)).toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });
  it("pastes with Shift+Insert like Omarchy's terminals", async () => {
    vi.mocked(readText).mockResolvedValue("pasted");
    const { handler, term } = harness();
    const e = event("Insert", true, false);
    expect(handler(e)).toBe(false);
    expect(e.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(term.paste).toHaveBeenCalledWith("pasted"));
  });
  it("uses Ctrl+Shift+C to copy and fully consumes the shortcut", () => {
    const { handler } = harness(true);
    const e = event("C", true);
    expect(handler(e)).toBe(false);
    expect(e.defaultPrevented).toBe(true);
    expect(writeText).toHaveBeenCalledWith("selected");
  });
  it("uses Ctrl+Shift+V to paste through xterm's bracketed-paste path", async () => {
    vi.mocked(readText).mockResolvedValue("你好\nworld");
    const { handler, term } = harness();
    const e = event("V", true);
    expect(handler(e)).toBe(false);
    expect(e.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(term.paste).toHaveBeenCalledWith("你好\nworld"));
  });
  it("uses Ctrl+Shift+F to search the terminal", () => {
    const { handler, onSearch } = harness();
    const e = event("F", true);
    expect(handler(e)).toBe(false);
    expect(e.defaultPrevented).toBe(true);
    expect(onSearch).toHaveBeenCalledOnce();
  });
});
