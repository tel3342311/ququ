use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub fn open(app: &AppHandle, label: &str) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(label) {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    let (url, title, width, height) = match label {
        "control" => ("index.html?panel=control", "蛐蛐控制面板", 800.0, 600.0),
        "history" => ("history.html", "转录历史 - 蛐蛐", 1000.0, 700.0),
        "settings" => ("settings.html", "设置 - 蛐蛐", 700.0, 600.0),
        _ => return Err("Unknown window".into()),
    };
    WebviewWindowBuilder::new(app, label, WebviewUrl::App(url.into()))
        .title(title)
        .inner_size(width, height)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}
