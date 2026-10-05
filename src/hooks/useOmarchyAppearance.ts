/**
 * React adapter for system appearance. Mounted with useTheme in every window,
 * so settings, editors and terminal renders share the same system snapshot.
 * @module hooks/useOmarchyAppearance
 */
import { useEffect, useSyncExternalStore } from "react";
import { useSettingsStore } from "@/stores/settingsStore";
import { getRuntimePlatform } from "@/utils/platform";
import { getOmarchyAppearance, subscribeOmarchyAppearance } from "@/theme/omarchyAppearance";
import { startOmarchyReader } from "@/services/theme/omarchyReader";

export function useOmarchyAppearance() {
  const follow = useSettingsStore(s => s.appearance.followSystemAppearance);
  useEffect(() => {
    if (!follow || getRuntimePlatform() !== "linux") return;
    return startOmarchyReader();
  }, [follow]);
  return useOmarchyAppearanceValue();
}

/** Read the shared snapshot without starting another file reader. */
export function useOmarchyAppearanceValue() {
  return useSyncExternalStore(subscribeOmarchyAppearance, getOmarchyAppearance, () => null);
}
