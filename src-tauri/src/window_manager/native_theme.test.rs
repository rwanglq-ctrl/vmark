//! Tests for `native_theme.rs` (included via `#[path]`).
//!
//! The apply-to-windows half needs a live Tauri runtime, so what is unit
//! tested here is the part that decides *what* to apply: the dark flag to
//! `Theme` mapping, and the process-global the window builders read when they
//! create a window after the user has already picked a theme.

use super::*;

// -- theme_for -------------------------------------------------------------

#[test]
fn dark_flag_maps_to_dark_theme() {
    assert_eq!(theme_for(true), Theme::Dark);
}

#[test]
fn light_flag_maps_to_light_theme() {
    assert_eq!(theme_for(false), Theme::Light);
}

// -- remembered preference -------------------------------------------------
//
// These share one process-global, so they run under a mutex and restore the
// previous value. Cargo runs tests in threads within a single process, so a
// bare `remember()` in one test is visible to every other.

use std::sync::Mutex;
static GUARD: Mutex<()> = Mutex::new(());

fn with_saved_preference(body: impl FnOnce()) {
    // Poisoning is irrelevant here: the guarded state is a single bool that
    // the closure always overwrites, so a panicking test cannot leave it
    // inconsistent for the next one.
    let _lock = GUARD.lock().unwrap_or_else(|e| e.into_inner());
    let previous = prefers_dark();
    body();
    remember(previous);
}

#[test]
fn remember_round_trips_dark() {
    with_saved_preference(|| {
        remember(true);
        assert!(prefers_dark());
        assert_eq!(current_theme(), Theme::Dark);
    });
}

#[test]
fn remember_round_trips_light() {
    with_saved_preference(|| {
        remember(false);
        assert!(!prefers_dark());
        assert_eq!(current_theme(), Theme::Light);
    });
}

#[test]
fn remember_is_idempotent() {
    with_saved_preference(|| {
        remember(true);
        remember(true);
        assert_eq!(current_theme(), Theme::Dark);
    });
}

#[test]
fn later_writes_win() {
    with_saved_preference(|| {
        remember(true);
        remember(false);
        assert_eq!(
            current_theme(),
            Theme::Light,
            "a theme switch must not be masked by the earlier value"
        );
    });
}

/// A window created before the frontend has ever reported a theme must still
/// get a definite theme rather than inheriting whatever the OS prefers —
/// otherwise the very first Settings window on a light-mode OS opens with
/// light chrome around a dark VMark theme.
#[test]
fn default_preference_is_light() {
    // Not wrapped in `with_saved_preference`: this asserts the *initial*
    // value of the global, which only holds before any test has written to
    // it. Re-establish it explicitly so ordering cannot make this flaky.
    let _lock = GUARD.lock().unwrap_or_else(|e| e.into_inner());
    remember(false);
    assert_eq!(current_theme(), Theme::Light);
}

// -- chrome colors (#1606) ---------------------------------------------------
//
// DWM takes a COLORREF, which is 0x00BBGGRR — the byte order is reversed from
// the `#RRGGBB` the theme catalog writes. Getting this wrong paints Sepia's
// caption blue, so every channel is pinned separately.

#[test]
fn hex_color_maps_to_colorref_byte_order() {
    assert_eq!(parse_hex_colorref("#112233"), Some(0x0033_2211));
    assert_eq!(parse_hex_colorref("#FF0000"), Some(0x0000_00FF));
    assert_eq!(parse_hex_colorref("#00FF00"), Some(0x0000_FF00));
    assert_eq!(parse_hex_colorref("#0000FF"), Some(0x00FF_0000));
}

#[test]
fn hex_color_accepts_either_case() {
    assert_eq!(parse_hex_colorref("#F9F0DB"), parse_hex_colorref("#f9f0db"));
    assert_eq!(parse_hex_colorref("#F9F0DB"), Some(0x00DB_F0F9));
}

#[test]
fn hex_color_covers_the_extremes() {
    assert_eq!(parse_hex_colorref("#000000"), Some(0));
    assert_eq!(parse_hex_colorref("#FFFFFF"), Some(0x00FF_FFFF));
}

/// Anything but exactly `#RRGGBB` is refused, never guessed at. In particular
/// `0xFFFFFFFF` (DWMWA_COLOR_DEFAULT) and `0xFFFFFFFE` (DWMWA_COLOR_NONE) are
/// sentinels with their own meaning, so no input may produce a value with the
/// high byte set — a 4-byte `#AARRGGBB` would.
#[test]
fn hex_color_refuses_every_other_shape() {
    for bad in [
        "", "#", "112233", "#12345", "#1234567", "#11223344", "#GG0000", "# 11223",
        "#11223 ", "rgba(0,0,0,1)", "white", "#１２３４５６", "#+12345", "#-12345",
    ] {
        assert_eq!(parse_hex_colorref(bad), None, "{bad:?} must be refused");
    }
}

fn input(caption: &str, text: &str, border: &str) -> NativeChromeInput {
    NativeChromeInput {
        caption: caption.into(),
        text: text.into(),
        border: border.into(),
    }
}

#[test]
fn chrome_input_parses_all_three_colors() {
    let colors = ChromeColors::parse(&input("#F9F0DB", "#5c4b37", "#e0d5bc")).unwrap();
    assert_eq!(
        colors,
        ChromeColors {
            caption: 0x00DB_F0F9,
            text: 0x0037_4B5C,
            border: 0x00BC_D5E0,
        }
    );
}

#[test]
fn chrome_input_refuses_a_bad_color_by_name() {
    for (which, chrome) in [
        ("caption", input("red", "#000000", "#000000")),
        ("text", input("#000000", "#00", "#000000")),
        ("border", input("#000000", "#000000", "")),
    ] {
        let err = ChromeColors::parse(&chrome).unwrap_err();
        assert_eq!(err.code(), crate::command_error::ErrorCode::InvalidInput);
        assert!(
            err.message().contains(which),
            "error should name the {which} field: {}",
            err.message()
        );
    }
}

/// The frontend's payload shape, exactly as `syncNativeTheme` sends it.
#[test]
fn chrome_input_deserializes_from_the_frontend_shape() {
    let parsed: NativeChromeInput = serde_json::from_value(serde_json::json!({
        "caption": "#F9F0DB", "text": "#5c4b37", "border": "#e0d5bc"
    }))
    .unwrap();
    assert_eq!(parsed.caption, "#F9F0DB");
    assert_eq!(parsed.text, "#5c4b37");
    assert_eq!(parsed.border, "#e0d5bc");
}

// -- capability ----------------------------------------------------------------

/// `DWMWA_CAPTION_COLOR` exists from Windows 11 (build 22000); on Windows 10
/// DWM rejects it, so the frontend must stay on the light/dark pair there.
#[test]
fn caption_color_starts_at_the_first_windows_11_build() {
    assert!(!caption_color_supported(19045), "Windows 10 22H2");
    assert!(!caption_color_supported(21999));
    assert!(caption_color_supported(22000), "Windows 11 21H2");
    assert!(caption_color_supported(26100), "Windows 11 24H2");
}

#[test]
fn capabilities_serialize_in_the_shape_the_frontend_reads() {
    let wire = serde_json::to_value(NativeThemeCapabilities {
        themed_caption: true,
    })
    .unwrap();
    assert_eq!(wire, serde_json::json!({ "themedCaption": true }));
}

/// macOS renders the full catalog through its overlay title bar, which the
/// frontend knows on its own; Linux cannot color its title bar at all. Neither
/// may claim a DWM caption.
#[cfg(not(target_os = "windows"))]
#[test]
fn no_themed_caption_off_windows() {
    assert!(!native_theme_capabilities().unwrap().themed_caption);
}
