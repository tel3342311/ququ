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

#[cfg(test)]
mod tests {
    use super::*;
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
