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
/// to Quartz logical points (origin top-left of primary screen).
pub fn macos_cursor_to_logical(mouse_cocoa: (f64, f64), primary_height: f64) -> (f64, f64) {
    (mouse_cocoa.0, primary_height - mouse_cocoa.1)
}

/// Places a logical point inside a monitor's physical space: offset from the
/// monitor's own point origin, scaled by that monitor, then added to its physical position.
pub fn macos_logical_to_anchor(
    logical: (f64, f64),
    monitor_position: (i32, i32),
    scale: f64,
) -> (i32, i32) {
    let origin = (
        f64::from(monitor_position.0) / scale,
        f64::from(monitor_position.1) / scale,
    );
    (
        monitor_position.0 + ((logical.0 - origin.0) * scale).round() as i32,
        monitor_position.1 + ((logical.1 - origin.1) * scale).round() as i32,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn macos_retina_cursor_to_anchor_preserves_unskewed_physical_placement() {
        let logical = macos_cursor_to_logical((960.0, 540.0), 1080.0);
        assert_eq!(logical, (960.0, 540.0));
        let anchor = macos_logical_to_anchor(logical, (0, 0), 2.0);
        assert_eq!(anchor, (1920, 1080));
        let (x, y) = place(
            anchor,
            WorkArea {
                left: 0,
                top: 0,
                width: 3840,
                height: 2160,
            },
            2.0,
        );
        assert_eq!((x, y), (1920 + 24, 1080 + 24));
    }

    #[test]
    fn macos_retina_cursor_near_top_and_bottom_coordinates() {
        let top = macos_cursor_to_logical((500.0, 1000.0), 1080.0);
        assert_eq!(top.1, 80.0);
        assert_eq!(macos_logical_to_anchor(top, (0, 0), 2.0).1, 160);
        let bottom = macos_cursor_to_logical((500.0, 50.0), 1080.0);
        assert_eq!(bottom.1, 1030.0);
        assert_eq!(macos_logical_to_anchor(bottom, (0, 0), 2.0).1, 2060);
    }

    #[test]
    fn macos_mixed_dpi_secondary_monitor_anchor_stays_in_work_area() {
        let anchor = macos_logical_to_anchor((1500.0, 100.0), (1440, 0), 1.0);
        assert_eq!(anchor, (1500, 100));
        let anchor = macos_logical_to_anchor((2000.0, 100.0), (3840, 0), 2.0);
        assert_eq!(anchor, (4000, 200));
        let (x, y) = place(
            anchor,
            WorkArea {
                left: 3840,
                top: 0,
                width: 3840,
                height: 2160,
            },
            2.0,
        );
        assert_eq!((x, y), (4000 + 24, 200 + 24));
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
