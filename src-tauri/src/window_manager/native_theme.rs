//! Keeps OS-drawn window chrome in step with VMark's in-app theme.
//!
//! Purpose: VMark themes everything it paints itself via CSS, but the title
//! bar and the Windows menu bar are drawn by the OS and ignore that entirely.
//! On a light-mode Windows install with VMark's night theme, the Settings
//! window gets a white title bar around a dark page.
//!
//! Pipeline: `useTheme` computes `isDark` and the theme's chrome colors →
//! `set_native_theme` → polarity remembered in a process-global → applied to
//! every open window (and, on Windows 11, the caption/text/border colors via
//! DWM). The window builders read the polarity again so windows opened
//! *later* start with the right light/dark chrome; their own frontend reports
//! the colors as soon as it boots.
//!
//! Capability: `native_theme_capabilities` tells the frontend whether the
//! caption can follow every theme. Only Windows 11 (build 22000+) can: it is
//! where `DWMWA_CAPTION_COLOR` exists. Windows 10 and Linux stay on the
//! light/dark pair (`theme/themeAvailability.ts`); macOS needs no answer.
//!
//! Key decisions:
//!   - macOS is deliberately excluded. Its Settings window uses an overlay
//!     title bar and its menu lives in the system bar, so it has no symptom;
//!     `set_theme` there would change NSAppearance app-wide, which is an
//!     unrequested behavior change on the primary platform.
//!   - The polarity is a process-global rather than Tauri state because the
//!     window builders need it before any window (and thus any `State`) is
//!     reachable, and it is a single bool.
//!   - Colors come from the theme catalog (`theme/nativeChrome.ts`); none are
//!     authored here. They are validated on every platform, so a malformed
//!     payload fails the same way on the machine that can test it.
//!   - The immersive dark-mode flag still follows polarity on Windows 11 —
//!     `set_theme` sets it — because it also drives the caption buttons and
//!     the window's context menus, which the color attributes do not reach.
//!
//! Known limitations:
//!   - The Windows **menu bar** is light or dark only, never sepia: muda draws
//!     it, and it has no color input. It also only follows this on a system
//!     already set to dark mode. muda gates its dark menu-bar drawing on
//!     `should_use_dark_mode() = should_apps_use_dark_mode() && !high_contrast
//!     && is_dark_mode_allowed_for_window()`. This module controls the third
//!     term; the first is the OS-wide "app dark mode" setting, which an
//!     application cannot override. The title bar has no such limit —
//!     `DWMWA_USE_IMMERSIVE_DARK_MODE` is per-window and always honored.
//!
//! @coordinates-with hooks/useTheme.ts — reports `isDark` and colors on every change
//! @coordinates-with services/theme/nativeThemeCapability.ts — reads the capability
//! @coordinates-with settings_window.rs, document_windows.rs — read `current_theme()`

use crate::command_error::CommandError;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Theme};
// Only the non-macOS branch enumerates windows; importing this unconditionally
// is an unused-import warning on macOS, and clippy runs with `-D warnings`.
#[cfg(not(target_os = "macos"))]
use tauri::Manager;

/// Last theme the frontend reported. Defaults to light so a window built
/// before the frontend has said anything gets a definite theme instead of
/// inheriting the OS preference.
static PREFERS_DARK: AtomicBool = AtomicBool::new(false);

/// The first Windows build with `DWMWA_CAPTION_COLOR` (Windows 11 21H2).
const FIRST_CAPTION_COLOR_BUILD: u32 = 22000;

/// Map the frontend's `isDark` flag onto a Tauri theme.
pub fn theme_for(dark: bool) -> Theme {
    if dark {
        Theme::Dark
    } else {
        Theme::Light
    }
}

/// Record the frontend's current theme for windows opened later.
pub fn remember(dark: bool) {
    PREFERS_DARK.store(dark, Ordering::Relaxed);
}

/// Whether the frontend last reported a dark theme.
pub fn prefers_dark() -> bool {
    PREFERS_DARK.load(Ordering::Relaxed)
}

/// The theme a newly built window should start with.
pub fn current_theme() -> Theme {
    theme_for(prefers_dark())
}

/// The theme's chrome colors as the frontend sends them: `#RRGGBB` strings.
#[derive(Debug, Clone, Deserialize)]
pub struct NativeChromeInput {
    pub caption: String,
    pub text: String,
    pub border: String,
}

/// Validated chrome colors, each a COLORREF (`0x00BBGGRR`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ChromeColors {
    pub caption: u32,
    pub text: u32,
    pub border: u32,
}

impl ChromeColors {
    /// Parse all three colors, naming the first field that is not `#RRGGBB`.
    pub fn parse(input: &NativeChromeInput) -> Result<Self, CommandError> {
        let field = |name: &str, value: &str| {
            parse_hex_colorref(value).ok_or_else(|| {
                CommandError::invalid_input(format!(
                    "chrome {name} color must be #RRGGBB, got {value:?}"
                ))
            })
        };
        Ok(Self {
            caption: field("caption", &input.caption)?,
            text: field("text", &input.text)?,
            border: field("border", &input.border)?,
        })
    }
}

/// `#RRGGBB` → COLORREF (`0x00BBGGRR`); anything else is `None`.
///
/// Every digit is checked as ASCII hex first: `u8::from_str_radix` alone would
/// accept a leading `+`. The result never has its high byte set, so it cannot
/// collide with DWM's `DWMWA_COLOR_DEFAULT`/`DWMWA_COLOR_NONE` sentinels.
pub fn parse_hex_colorref(value: &str) -> Option<u32> {
    let digits = value.strip_prefix('#')?;
    if digits.len() != 6 || !digits.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let channel = |at: usize| u32::from_str_radix(&digits[at..at + 2], 16).ok();
    let (red, green, blue) = (channel(0)?, channel(2)?, channel(4)?);
    Some(blue << 16 | green << 8 | red)
}

/// Whether a Windows build can color its caption (`DWMWA_CAPTION_COLOR`).
pub fn caption_color_supported(build: u32) -> bool {
    build >= FIRST_CAPTION_COLOR_BUILD
}

/// What the native chrome can render, as the frontend reads it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeThemeCapabilities {
    /// The caption can take any theme's colors (Windows 11), so the frontend
    /// may offer and render the full catalog.
    pub themed_caption: bool,
}

/// The Windows build this process runs on; `None` on every other OS.
fn windows_build() -> Option<u32> {
    #[cfg(target_os = "windows")]
    {
        dwm::build_number()
    }
    #[cfg(not(target_os = "windows"))]
    {
        None
    }
}

/// Whether this process's windows can have a theme-colored caption.
fn themed_caption_supported() -> bool {
    windows_build().is_some_and(caption_color_supported)
}

/// Push the remembered theme, and on Windows 11 the colors, onto every open
/// window.
///
/// Applied to all windows rather than just the caller's: the theme is a
/// single app-wide setting, and Settings is a separate window from the
/// document window whose UI changed it.
fn apply_to_all_windows(app: &AppHandle, colors: ChromeColors) {
    // macOS has no symptom and `set_theme` there is app-wide — see header.
    #[cfg(not(target_os = "macos"))]
    {
        let theme = current_theme();
        let tint = themed_caption_supported();
        log::debug!("[native_theme] applying {theme:?} (caption colors: {tint}) to open windows");
        for (label, window) in app.webview_windows() {
            // Best-effort per window: one failing window (e.g. one closing
            // mid-iteration) must not stop the rest from being themed.
            if let Err(e) = window.set_theme(Some(theme)) {
                log::warn!("[native_theme] could not theme window {label:?}: {e}");
            }
            #[cfg(target_os = "windows")]
            if tint {
                if let Err(e) = window.hwnd().map_err(|e| e.to_string()).and_then(|hwnd| {
                    dwm::apply_colors(hwnd, colors).map_err(|e| e.to_string())
                }) {
                    log::warn!("[native_theme] could not color window {label:?}: {e}");
                }
            }
        }
        #[cfg(not(target_os = "windows"))]
        let _ = (tint, colors);
    }
    #[cfg(target_os = "macos")]
    let _ = (app, colors);
}

/// Report the in-app theme so native chrome can follow it.
///
/// Called by the frontend whenever the resolved theme changes (including at
/// startup), so this runs often and stays cheap. A malformed color refuses the
/// whole report before anything is remembered or applied.
#[tauri::command]
pub fn set_native_theme(
    app: AppHandle,
    dark: bool,
    chrome: NativeChromeInput,
) -> Result<(), CommandError> {
    let colors = ChromeColors::parse(&chrome)?;
    remember(dark);
    apply_to_all_windows(&app, colors);
    Ok(())
}

/// Whether the native caption can follow every theme on this machine.
#[tauri::command]
pub fn native_theme_capabilities() -> Result<NativeThemeCapabilities, CommandError> {
    Ok(NativeThemeCapabilities {
        themed_caption: themed_caption_supported(),
    })
}

/// The Windows calls: the OS build, and the three DWM color attributes.
#[cfg(target_os = "windows")]
mod dwm {
    use super::ChromeColors;
    use std::sync::OnceLock;
    use windows::Wdk::System::SystemServices::RtlGetVersion;
    use windows::Win32::Foundation::{COLORREF, HWND};
    use windows::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_CAPTION_COLOR, DWMWA_TEXT_COLOR,
    };
    use windows::Win32::System::SystemInformation::OSVERSIONINFOW;

    /// The real OS build. `RtlGetVersion`, not `GetVersionExW`: the latter
    /// reports whatever the app manifest claims compatibility with. Read once.
    pub fn build_number() -> Option<u32> {
        static BUILD: OnceLock<Option<u32>> = OnceLock::new();
        *BUILD.get_or_init(|| {
            let mut info = OSVERSIONINFOW {
                dwOSVersionInfoSize: std::mem::size_of::<OSVERSIONINFOW>() as u32,
                ..Default::default()
            };
            // SAFETY: `info` is a properly sized, writable OSVERSIONINFOW.
            let status = unsafe { RtlGetVersion(&mut info) };
            status.is_ok().then_some(info.dwBuildNumber)
        })
    }

    /// Set caption, caption-text and border colors on one window.
    pub fn apply_colors(hwnd: HWND, colors: ChromeColors) -> windows::core::Result<()> {
        for (attribute, value) in [
            (DWMWA_CAPTION_COLOR, colors.caption),
            (DWMWA_TEXT_COLOR, colors.text),
            (DWMWA_BORDER_COLOR, colors.border),
        ] {
            let color = COLORREF(value);
            // SAFETY: the pointer and size describe `color`, a live COLORREF,
            // which is what these three attributes take.
            unsafe {
                DwmSetWindowAttribute(
                    hwnd,
                    attribute,
                    std::ptr::from_ref(&color).cast(),
                    std::mem::size_of::<COLORREF>() as u32,
                )
            }?;
        }
        Ok(())
    }
}

#[cfg(test)]
#[path = "native_theme.test.rs"]
mod tests;
