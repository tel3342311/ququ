#[derive(Debug, Clone, Copy)]
pub struct WorkArea {
    pub left: i32,
    pub top: i32,
    pub width: u32,
    pub height: u32,
}

pub const WIDTH: f64 = 160.0;
pub const HEIGHT: f64 = 32.0;

pub fn place(anchor: (i32, i32), area: WorkArea, scale: f64) -> (i32, i32) {
    let width = (WIDTH * scale).ceil() as i64;
    let height = (HEIGHT * scale).ceil() as i64;
    let gap = (12.0 * scale).ceil() as i64;
    let left = i64::from(area.left);
    let top = i64::from(area.top);
    let right = left + i64::from(area.width);
    let bottom = top + i64::from(area.height);
    let x = (i64::from(anchor.0) + gap).clamp(left, (right - width).max(left));
    let below = i64::from(anchor.1) + gap;
    let y = if below + height <= bottom {
        below
    } else {
        i64::from(anchor.1) - height - gap
    };
    (x as i32, y.clamp(top, (bottom - height).max(top)) as i32)
}

/// Translates Cocoa mouseLocation (points, origin bottom-left of primary screen)
/// to Quartz logical coordinates (points, origin top-left of primary screen)
/// and physical pixel coordinates for the target monitor.
pub fn macos_cursor_to_anchor(
    mouse_cocoa: (f64, f64),
    primary_height: f64,
    scale: f64,
) -> ((f64, f64), (i32, i32)) {
    let logical_x = mouse_cocoa.0;
    let logical_y = primary_height - mouse_cocoa.1;
    let anchor = (
        (logical_x * scale).round() as i32,
        (logical_y * scale).round() as i32,
    );
    ((logical_x, logical_y), anchor)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn macos_retina_cursor_to_anchor_preserves_unskewed_physical_placement() {
        let primary_height = 1080.0;
        let scale = 2.0;
        // Mouse near center of screen (logical point x=960, y=540 from bottom in Cocoa):
        let ((log_x, log_y), anchor) =
            macos_cursor_to_anchor((960.0, 540.0), primary_height, scale);
        assert_eq!(log_x, 960.0);
        assert_eq!(log_y, 540.0);
        assert_eq!(anchor, (1920, 1080));

        let (x, y) = place(
            anchor,
            WorkArea {
                left: 0,
                top: 0,
                width: 3840,
                height: 2160,
            },
            scale,
        );
        // On Retina 2x, gap is 24px (12pt * 2), width is 320px, height is 64px.
        // It should place adjacent to the anchor without clamping to the bottom.
        assert_eq!(x, 1920 + 24);
        assert_eq!(y, 1080 + 24);
    }

    #[test]
    fn macos_retina_cursor_near_top_and_bottom_coordinates() {
        let primary_height = 1080.0;
        let scale = 2.0;
        // Near top of screen (Cocoa y=1000 from bottom -> 80 from top):
        let ((_, log_y_top), anchor_top) =
            macos_cursor_to_anchor((500.0, 1000.0), primary_height, scale);
        assert_eq!(log_y_top, 80.0);
        assert_eq!(anchor_top.1, 160);

        // Near bottom of screen (Cocoa y=50 from bottom -> 1030 from top):
        let ((_, log_y_bot), anchor_bot) =
            macos_cursor_to_anchor((500.0, 50.0), primary_height, scale);
        assert_eq!(log_y_bot, 1030.0);
        assert_eq!(anchor_bot.1, 2060);
    }
    #[test]
    fn keeps_indicator_inside_negative_coordinate_monitor() {
        let (x, y) = place(
            (-5, 1035),
            WorkArea {
                left: -1920,
                top: 0,
                width: 1920,
                height: 1040,
            },
            1.0,
        );
        assert!(x >= -1920 && x + 160 <= 0);
        assert!(y >= 0 && y + 32 <= 1040);
    }
    #[test]
    fn uses_target_monitor_scale_at_screen_edges() {
        let (x, y) = place(
            (2558, -1),
            WorkArea {
                left: 0,
                top: -1440,
                width: 2560,
                height: 1440,
            },
            2.0,
        );
        assert!(x + 320 <= 2560);
        assert!(y + 64 <= 0);
        assert!(y >= -1440);
    }
    #[test]
    fn minimum_work_area_does_not_panic() {
        assert_eq!(
            place(
                (100, 100),
                WorkArea {
                    left: 10,
                    top: 20,
                    width: 1,
                    height: 1
                },
                2.0
            ),
            (10, 20)
        );
    }
}
