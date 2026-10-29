/**
 * Effective Theme Resolution
 *
 * Purpose: Single source of truth for which theme id is actually in effect —
 * the manually selected theme, or (when follow-system-appearance is on) the
 * paired light/dark theme matching the current OS preference (#1125).
 *
 * Every consumer that used to read `appearance.theme` directly goes through
 * here: `useTheme`, `useIsDarkTheme`, and the terminal xterm retheming.
 * `appearance.theme` itself remains the user's manual pick and is never
 * mutated by system flips.
 *
 * Consumers remain responsible for guarding unknown ids
 * (`themes[id] ?? themes.paper`) — `resolveEffectiveThemeId` resolves, it
 * doesn't validate, and is deliberately pure so it stays platform-agnostic.
 *
 * The exported hook and getter additionally narrow the result to what the
 * platform's native chrome can render (`theme/themeAvailability.ts`): Windows
 * 10 and Linux draw their own title bar and accept only light or dark, so a
 * theme outside that pair would always render half-themed. `appearance.theme`
 * is never mutated, so the user's pick survives a round trip back to macOS or
 * Windows 11.
 *
 * @coordinates-with services/theme/nativeThemeCapability.ts — whether the full catalog renders
 * @coordinates-with stores/systemAppearanceStore.ts — OS dark-mode observation
 * @coordinates-with stores/settingsStore.ts — appearance preferences
 * @module hooks/useEffectiveTheme
 */

import { useSettingsStore, type AppearanceSettings } from "@/stores/settingsStore";
import { initialState } from "@/stores/settingsStore/defaults";
import { useSystemAppearanceStore } from "@/stores/systemAppearanceStore";
import type { ThemeId } from "@/theme/themes";
import { coerceThemeId } from "@/theme/themeAvailability";
import { offersFullThemeCatalog } from "@/services/theme/nativeThemeCapability";

type EffectiveThemeInput = Pick<
  AppearanceSettings,
  "theme" | "followSystemAppearance" | "systemLightTheme" | "systemDarkTheme"
>;

/** Pure resolver — exported for testing. Missing paired ids (pre-#1125
 *  persisted blobs mid-migration) fall back to the shipped defaults. */
export function resolveEffectiveThemeId(
  appearance: EffectiveThemeInput,
  prefersDark: boolean
): ThemeId {
  if (!appearance.followSystemAppearance) return appearance.theme;
  return prefersDark
    ? (appearance.systemDarkTheme ?? initialState.appearance.systemDarkTheme)
    : (appearance.systemLightTheme ?? initialState.appearance.systemLightTheme);
}

/**
 * Resolve, then narrow to what this platform's native chrome can render.
 *
 * Kept separate from `resolveEffectiveThemeId` so that stays pure and
 * platform-agnostic: it resolves, it doesn't validate. Windows 10 and Linux
 * only draw light or dark chrome, so a theme outside that pair would always
 * render half-themed; macOS and Windows 11 render the full catalog
 * (`services/theme/nativeThemeCapability.ts`). `appearance.theme` is never
 * mutated, so the user's original pick survives a round trip between them.
 */
function resolveForPlatform(
  appearance: EffectiveThemeInput,
  prefersDark: boolean
): ThemeId {
  return coerceThemeId(
    resolveEffectiveThemeId(appearance, prefersDark),
    offersFullThemeCatalog()
  );
}

/** Non-reactive read for callbacks and store subscribers. */
export function getEffectiveThemeId(): ThemeId {
  return resolveForPlatform(
    useSettingsStore.getState().appearance,
    useSystemAppearanceStore.getState().prefersDark
  );
}

/** Reactive effective theme id — re-renders on manual theme changes, on
 *  follow-system toggling, and on OS light/dark flips while following. */
export function useEffectiveThemeId(): ThemeId {
  const theme = useSettingsStore((s) => s.appearance.theme);
  const follow = useSettingsStore((s) => s.appearance.followSystemAppearance);
  const light = useSettingsStore((s) => s.appearance.systemLightTheme);
  const dark = useSettingsStore((s) => s.appearance.systemDarkTheme);
  const prefersDark = useSystemAppearanceStore((s) => s.prefersDark);
  return resolveForPlatform(
    { theme, followSystemAppearance: follow, systemLightTheme: light, systemDarkTheme: dark },
    prefersDark
  );
}
