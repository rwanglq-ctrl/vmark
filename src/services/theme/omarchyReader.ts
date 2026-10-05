/**
 * Cancellable Linux system appearance reader shared by document and Settings
 * windows. Uses scoped asset access, then publishes one typed appearance.
 * @module services/theme/omarchyReader
 */
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { homeDir } from "@tauri-apps/api/path";
import { useSettingsStore } from "@/stores/settingsStore";
import { buildOmarchyAppearance, setOmarchyAppearance, type SystemGuiFont } from "@/theme/omarchyAppearance";

/** Start one reader; teardown cancels file reads and discards pending results. */
export function startOmarchyReader(): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  async function refresh() {
    if (stopped) return;
    controller = new AbortController();
    try {
      const home = await homeDir();
      const read = async (path: string) => {
        const response = await fetch(`${convertFileSrc(home.replace(/\/$/, "") + path)}?appearance=${Date.now()}`, { cache: "no-store", signal: controller?.signal ?? null });
        if (!response.ok) throw new Error("System appearance file unavailable");
        return response.text();
      };
      const [colors, foot] = await Promise.all([read("/.local/state/omarchy/current/theme/colors.toml"), read("/.config/foot/foot.ini")]);
      if (stopped || !useSettingsStore.getState().appearance.followSystemAppearance) return;
      const validated = buildOmarchyAppearance(colors, foot, { family: "Sans", points: 14 });
      const c = validated.theme.color;
      const font = await invoke<SystemGuiFont | null>("set_native_theme", {
        dark: validated.theme.isDark,
        appearance: { background: c.bg.primary, foreground: c.text.primary, selection: c.selection, border: c.border },
      });
      if (stopped || !useSettingsStore.getState().appearance.followSystemAppearance) return;
      const profile = buildOmarchyAppearance(colors, foot, font ?? { family: "Sans", points: 14 });
      const state = useSettingsStore.getState();
      const reading = { latinFont: ["Sans", "Sans Serif", "sans-serif"].includes(profile.uiFont) ? "system" : `custom:${profile.uiFont}`, cjkFont: "system", monoFont: `custom:${profile.monoFont}`, fontSize: Math.round(profile.uiSize) };
      for (const [key, value] of Object.entries(reading)) {
        const k = key as keyof typeof reading;
        if (state.appearance[k] !== value) state.updateAppearanceSetting(k, value as never);
      }
      const terminal = { fontSize: Math.round(profile.monoSize), lineHeight: profile.terminalLineHeight, cursorBlink: profile.cursorBlink, cursorStyle: profile.cursorStyle, minimumContrastRatio: 1 };
      for (const [key, value] of Object.entries(terminal)) {
        const k = key as keyof typeof terminal;
        if (state.terminal[k] !== value) state.updateTerminalSetting(k, value as never);
      }
      setOmarchyAppearance(profile);
    } catch {
      // Preserve the last complete snapshot during theme replacement or a
      // transient read failure. Retry without changing the user's document.
    } finally {
      if (!stopped) timer = setTimeout(() => { void refresh(); }, 3000);
    }
  }
  void refresh();
  return () => {
    stopped = true;
    controller?.abort();
    if (timer !== undefined) clearTimeout(timer);
    setOmarchyAppearance(null);
  };
}
