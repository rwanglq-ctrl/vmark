//! Pure font parsing and validated GTK style generation for Omarchy.

pub fn parse_font(value: &str) -> (String, f64) {
    let value = value.trim();
    let (family, size) = value.rsplit_once(' ').unwrap_or((value, "14"));
    let points = size
        .parse::<f64>()
        .ok()
        .filter(|v| v.is_finite() && (6.0..=48.0).contains(v))
        .unwrap_or(14.0);
    (
        if family.is_empty() {
            "Sans".into()
        } else {
            family.into()
        },
        points,
    )
}

pub fn native_css(colors: &[&str; 4], family: &str, points: f64) -> Result<String, String> {
    if colors.iter().any(|c| {
        c.len() != 7 || !c.starts_with('#') || !c[1..].bytes().all(|b| b.is_ascii_hexdigit())
    }) {
        return Err("Invalid native theme color".into());
    }
    if !points.is_finite() || !(6.0..=48.0).contains(&points) {
        return Err("Invalid native font size".into());
    }
    let font = family
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace(['\n', '\r'], " ");
    let [background, foreground, selection, border] = colors;
    Ok(format!(
        "window, .background, headerbar, .titlebar, menubar, menu {{ background-color: {background}; background-image: none; color: {foreground}; }}\n\
         headerbar, .titlebar, menubar, menu, menuitem {{ font-family: \"{font}\"; font-size: {points}pt; }}\n\
         menubar > menuitem, menu menuitem {{ color: {foreground}; }}\n\
         menubar > menuitem:hover, menu menuitem:hover {{ background-color: {selection}; color: {foreground}; }}\n\
         menubar {{ border-bottom: 1px solid {border}; }}"
    ))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn font_points_and_unicode_are_preserved() {
        assert_eq!(
            parse_font("Noto Sans CJK SC 14"),
            ("Noto Sans CJK SC".into(), 14.0)
        );
        assert_eq!(parse_font("霞鹜文楷 13.5"), ("霞鹜文楷".into(), 13.5));
        assert_eq!(parse_font("Sans NaN"), ("Sans".into(), 14.0));
        assert_eq!(parse_font(""), ("Sans".into(), 14.0));
    }
    #[test]
    fn rejects_css_color_injection() {
        assert!(native_css(&["#0B1220", "#E2E8F0", "#1B2C4E", "#131F37"], "Sans", 14.0).is_ok());
        assert!(native_css(
            &["red; @import", "#E2E8F0", "#1B2C4E", "#131F37"],
            "Sans",
            14.0
        )
        .is_err());
        assert!(native_css(
            &["#0B1220", "#E2E8F0", "#1B2C4E", "#131F37"],
            "Sans",
            f64::NAN
        )
        .is_err());
    }
    #[test]
    fn native_menu_typography_uses_system_points() {
        let css = native_css(&["#0B1220", "#E2E8F0", "#1B2C4E", "#131F37"], "Sans", 14.0).unwrap();
        assert!(css.contains("font-size: 14pt"));
        assert!(css.contains("#0B1220"));
        assert!(css.contains("background-image: none"));
    }
}
