use ferrous_opencc::{config::BuiltinConfig, OpenCC};
use std::sync::OnceLock;

fn s2twp_converter() -> &'static OpenCC {
    static CONVERTER: OnceLock<OpenCC> = OnceLock::new();
    CONVERTER.get_or_init(|| {
        OpenCC::from_config(BuiltinConfig::S2twp)
            .expect("embedded OpenCC s2twp configuration must load")
    })
}

fn is_cjk_ideograph(ch: char) -> bool {
    matches!(
        ch as u32,
        0x3400..=0x4DBF
            | 0x4E00..=0x9FFF
            | 0xF900..=0xFAFF
            | 0x20000..=0x323AF
    )
}

fn is_japanese_kana(ch: char) -> bool {
    matches!(
        ch as u32,
        0x3040..=0x309F | 0x30A0..=0x30FF | 0x31F0..=0x31FF | 0xFF65..=0xFF9F
    )
}

/// Convert Simplified Chinese text to Traditional Chinese (Taiwan, `s2twp`),
/// leaving non-Chinese text (including ASCII/Latin, Korean Hangul, and Japanese
/// text containing Kana) unchanged.
pub fn to_traditional_tw(text: &str) -> String {
    if text.is_empty() || !text.chars().any(is_cjk_ideograph) || text.chars().any(is_japanese_kana)
    {
        return text.to_owned();
    }
    s2twp_converter().convert(text)
}

/// Convert recognized or post-processed text to Traditional Chinese (Taiwan)
/// when the active language is Mandarin (`zh`) or auto-detected (`auto`).
/// Explicit non-Mandarin languages (`en`, `ja`, `ko`, `yue`) are preserved verbatim.
pub fn convert_for_language(text: &str, language: &str) -> String {
    match language {
        "zh" | "zh-TW" | "zh-CN" | "auto" | "" => to_traditional_tw(text),
        _ => text.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_simplified_chinese_and_mainland_terms_to_taiwan_traditional() {
        assert_eq!(
            convert_for_language(
                "这个软体的语音辨识结果应该要显示繁体中文，而不是简体字。我们今天来测试资料库与网络连线。",
                "zh"
            ),
            "這個軟體的語音辨識結果應該要顯示繁體中文，而不是簡體字。我們今天來測試資料庫與網路連線。"
        );
        assert_eq!(
            convert_for_language("在服务器的硬盘里用软件处理数据库和网络信息", "zh"),
            "在伺服器的硬碟裡用軟體處理資料庫和網路資訊"
        );
    }

    #[test]
    fn preserves_already_traditional_taiwan_text() {
        let traditional =
            "這個軟體的語音辨識結果應該要顯示繁體中文，而不是簡體字。我們今天來測試資料庫與網路連線。";
        assert_eq!(convert_for_language(traditional, "zh"), traditional);
    }

    #[test]
    fn preserves_english_mixed_code_and_non_chinese_languages() {
        let english = "Hello, world! Version 0.0.4 on macOS (ARM64) with Rust & Tauri.";
        assert_eq!(convert_for_language(english, "en"), english);
        assert_eq!(convert_for_language(english, "zh"), english);
        assert_eq!(convert_for_language(english, "auto"), english);

        assert_eq!(
            convert_for_language("今天用 Rust 写了 3 个 API endpoint，测试完成！", "zh"),
            "今天用 Rust 寫了 3 個 API endpoint，測試完成！"
        );

        // Explicit Japanese (even Kanji-only) and auto-detected Japanese with Kana must not be mangled.
        assert_eq!(convert_for_language("図書館", "ja"), "図書館");
        assert_eq!(
            convert_for_language("東京駅で新幹線の切符を買う", "auto"),
            "東京駅で新幹線の切符を買う"
        );

        // Korean and Cantonese pass through untouched.
        assert_eq!(
            convert_for_language("안녕하세요, 오늘 날씨가 좋네요.", "ko"),
            "안녕하세요, 오늘 날씨가 좋네요."
        );
        assert_eq!(convert_for_language("唔該晒", "yue"), "唔該晒");
    }
}
