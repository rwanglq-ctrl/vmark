//! Keeps OS-drawn window chrome in step with VMark's in-app theme.
//!
//! Purpose: VMark themes everything it paints itself via CSS, but the title
//! bar and the Windows menu bar are drawn by the OS and ignore that entirely.
//! On a light-mode Windows install with VMark's night theme, the Settings
//! window gets a white title bar around a dark page.
//!
//! Pipeline: `useTheme` computes `isDark` → `set_native_theme` → remembered in
//! a process-global → applied to every open window, and read again by the
//! window builders so windows opened *later* start with the right chrome.
//!
//! Key decisions:
//!   - macOS is deliberately excluded. Its Settings window uses an overlay
//!     title bar and its menu lives in the system bar, so it has no symptom;
//!     `set_theme` there would change NSAppearance app-wide, which is an
//!     unrequested behavior change on the primary platform.
//!   - The preference is a process-global rather than Tauri state because the
//!     window builders need it before any window (and thus any `State`) is
//!     reachable, and it is a single bool.
//!
//! Known limitations:
//!   - The Windows **menu bar** only follows this on a system already set to
//!     dark mode. muda gates its dark menu-bar drawing on
//!     `should_use_dark_mode() = should_apps_use_dark_mode() && !high_contrast
//!     && is_dark_mode_allowed_for_window()`. This module controls the third
//!     term; the first is the OS-wide "app dark mode" setting, which an
//!     application cannot override. The title bar has no such limit —
//!     `DWMWA_USE_IMMERSIVE_DARK_MODE` is per-window and always honored.
//!
//! @coordinates-with hooks/useTheme.ts — reports `isDark` on every change
//! @coordinates-with settings_window.rs, document_windows.rs — read `current_theme()`

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Theme};
#[cfg(target_os = "linux")]
#[path = "omarchy_style.rs"]
mod omarchy_style;

#[derive(Clone, serde::Deserialize)]
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub struct NativeAppearance {
    background: String,
    foreground: String,
    selection: String,
    border: String,
}

#[derive(serde::Serialize)]
pub struct SystemGuiFont {
    family: String,
    points: f64,
}

#[cfg(target_os = "linux")]
thread_local! {
    static SYSTEM_CSS: std::cell::RefCell<Option<(gtk::CssProvider, String)>> = const { std::cell::RefCell::new(None) };
}
// Only the non-macOS branch enumerates windows; importing this unconditionally
// is an unused-import warning on macOS, and clippy runs with `-D warnings`.
#[cfg(not(target_os = "macos"))]
use tauri::Manager;

/// Last theme the frontend reported. Defaults to light so a window built
/// before the frontend has said anything gets a definite theme instead of
/// inheriting the OS preference.
static PREFERS_DARK: AtomicBool = AtomicBool::new(false);

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

/// Push the remembered theme onto every open window.
///
/// Applied to all windows rather than just the caller's: the theme is a
/// single app-wide setting, and Settings is a separate window from the
/// document window whose UI changed it.
fn apply_to_all_windows(app: &AppHandle) {
    // macOS has no symptom and `set_theme` there is app-wide — see header.
    #[cfg(not(target_os = "macos"))]
    {
        let theme = current_theme();
        log::debug!("[native_theme] applying {theme:?} to open windows");
        for (label, window) in app.webview_windows() {
            // Best-effort per window: one failing window (e.g. one closing
            // mid-iteration) must not stop the rest from being themed.
            if let Err(e) = window.set_theme(Some(theme)) {
                log::warn!("[native_theme] could not theme window {label:?}: {e}");
            }
        }
    }
    #[cfg(target_os = "macos")]
    let _ = app;
}

/// Report the in-app theme so native chrome can follow it.
///
/// Called by the frontend whenever the resolved theme changes (including at
/// startup), so this runs often and stays cheap and infallible in practice.
#[tauri::command]
pub async fn set_native_theme(
    app: AppHandle,
    dark: bool,
    appearance: Option<NativeAppearance>,
) -> Result<Option<SystemGuiFont>, String> {
    remember(dark);
    apply_to_all_windows(&app);
    #[cfg(target_os = "linux")]
    {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        app.run_on_main_thread(move || {
            use gtk::prelude::*;
            let result = (|| {
                let screen = gtk::gdk::Screen::default().ok_or("GTK screen unavailable")?;
                let font = gtk::Settings::default()
                    .and_then(|s| s.gtk_font_name())
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| "Sans 14".into());
                let (family, points) = omarchy_style::parse_font(&font);
                SYSTEM_CSS.with(|state| -> Result<(), String> {
                    let mut state = state.borrow_mut();
                    let Some(colors) = appearance else {
                        if let Some((provider, _)) = state.take() {
                            gtk::StyleContext::remove_provider_for_screen(&screen, &provider);
                        }
                        return Ok(());
                    };
                    let css = omarchy_style::native_css(
                        &[
                            &colors.background,
                            &colors.foreground,
                            &colors.selection,
                            &colors.border,
                        ],
                        &family,
                        points,
                    )?;
                    if state.as_ref().is_some_and(|(_, previous)| previous == &css) {
                        return Ok(());
                    }
                    let provider = gtk::CssProvider::new();
                    provider
                        .load_from_data(css.as_bytes())
                        .map_err(|e| e.to_string())?;
                    if let Some((previous, _)) = state.take() {
                        gtk::StyleContext::remove_provider_for_screen(&screen, &previous);
                    }
                    gtk::StyleContext::add_provider_for_screen(
                        &screen,
                        &provider,
                        gtk::STYLE_PROVIDER_PRIORITY_USER,
                    );
                    *state = Some((provider, css));
                    Ok(())
                })?;
                Ok(Some(SystemGuiFont { family, points }))
            })();
            let _ = sender.send(result);
        })
        .map_err(|e| e.to_string())?;
        receiver.await.map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = appearance;
        Ok(None)
    }
}

#[cfg(test)]
#[path = "native_theme.test.rs"]
mod tests;
