use serde_json::{json, Value};

const OPENAI_DEFAULT_BASE_URL: &str = "https://api.openai.com/v1";
const GOOGLE_AI_DEFAULT_BASE_URL: &str = "https://generativelanguage.googleapis.com/v1beta/openai";
const OPENAI_DEFAULT_MODEL: &str = "gpt-3.5-turbo";
const GOOGLE_AI_DEFAULT_MODEL: &str = "gemini-3.8-flash";

fn is_google_config(config: &Value, raw_base: Option<&str>) -> bool {
    raw_base.is_some_and(|b| {
        b.to_ascii_lowercase()
            .contains("generativelanguage.googleapis.com")
    }) || config["ai_provider"].as_str() == Some("google")
}

fn build_request_payload(
    config: &Value,
    text: &str,
    mode: &str,
    test: bool,
) -> Result<(String, String, String, Value), String> {
    let key = config["ai_api_key"]
        .as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or("請先設定 AI API 金鑰")?;
    let raw_base = config["ai_base_url"]
        .as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let is_google = is_google_config(config, raw_base);
    let default_base = if is_google {
        GOOGLE_AI_DEFAULT_BASE_URL
    } else {
        OPENAI_DEFAULT_BASE_URL
    };
    let base = raw_base.unwrap_or(default_base).trim_end_matches('/');
    let default_model = if is_google {
        GOOGLE_AI_DEFAULT_MODEL
    } else {
        OPENAI_DEFAULT_MODEL
    };
    let model = config["ai_model"]
        .as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(default_model);
    let language = config["speech_language"].as_str().unwrap_or("zh");
    let input_text = ququ_speech::convert_for_language(text, language);
    let prompts: Value =
        serde_json::from_str(include_str!("../prompts.json")).map_err(|e| e.to_string())?;
    let prompt = if test {
        "請回覆測試成功".to_string()
    } else {
        prompts[mode]
            .as_str()
            .or_else(|| prompts["optimize"].as_str())
            .ok_or("Missing prompt")?
            .replace("__QUQU_INPUT_TEXT__", &input_text)
    };
    let body = if is_google {
        json!({
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.3,
            "reasoning_effort": "low",
            "stream": false
        })
    } else {
        json!({
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.3,
            "max_tokens": if test { 50 } else { 2000 },
            "stream": false
        })
    };
    Ok((
        format!("{base}/chat/completions"),
        key.to_string(),
        model.to_string(),
        body,
    ))
}

fn extract_error_message(body: &Value) -> Option<&str> {
    let candidate = body.as_array().and_then(|arr| arr.first()).unwrap_or(body);
    candidate
        .get("error")
        .and_then(|err| {
            err.get("message")
                .and_then(Value::as_str)
                .or_else(|| err.as_str())
        })
        .or_else(|| candidate.get("message").and_then(Value::as_str))
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

fn parse_completion_body(
    status_code: u16,
    is_success: bool,
    body: &Value,
    model: &str,
    test: bool,
) -> Result<Value, String> {
    if !is_success {
        return Err(match extract_error_message(body) {
            Some(msg) => format!("AI 請求失敗 (HTTP {status_code}): {msg}"),
            None => format!("AI 請求失敗 (HTTP {status_code})"),
        });
    }
    let content = body["choices"][0]["message"]["content"]
        .as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or("AI 回傳格式錯誤")?;
    Ok(if test {
        json!({
            "available": true,
            "success": true,
            "message": "測試成功",
            "model": model,
            "response": content,
            "details": format!("成功連線至 {model}，回應時間正常"),
            "usage": body["usage"]
        })
    } else {
        json!({
            "success": true,
            "text": content,
            "usage": body["usage"],
            "model": model
        })
    })
}

pub async fn complete(config: Value, text: &str, mode: &str, test: bool) -> Result<Value, String> {
    let (url, key, model, request_body) = build_request_payload(&config, text, mode, test)?;
    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?
        .post(url)
        .bearer_auth(key)
        .json(&request_body)
        .send()
        .await
        .map_err(|_| "無法連線至 AI 服務，請檢查網址與網路連線".to_string())?;
    let status = response.status();
    let raw_text = response
        .text()
        .await
        .map_err(|_| "AI 服務回傳了無效的內容".to_string())?;
    let body: Value = match serde_json::from_str(&raw_text) {
        Ok(parsed) => parsed,
        Err(_) if !status.is_success() => {
            return Err(format!("AI 請求失敗 (HTTP {})", status.as_u16()));
        }
        Err(_) => return Err("AI 服務回傳了無效的 JSON".to_string()),
    };
    let mut result =
        parse_completion_body(status.as_u16(), status.is_success(), &body, &model, test)?;
    if !test {
        let language = config["speech_language"].as_str().unwrap_or("zh");
        if let Some(out_text) = result["text"].as_str() {
            let validated = validate_output_safety(text, out_text)?;
            result["text"] = json!(ququ_speech::convert_for_language(&validated, language));
        }
    }
    Ok(result)
}

pub fn strip_think_tags(text: &str) -> Result<String, String> {
    let lower = text.to_ascii_lowercase();
    if let Some(start) = lower.find("<think>") {
        if let Some(end_offset) = lower[start..].find("</think>") {
            let end = start + end_offset + "</think>".len();
            let stripped = format!("{}{}", &text[..start], &text[end..]);
            return strip_think_tags(stripped.trim());
        } else {
            let prefix = text[..start].trim();
            if prefix.is_empty() {
                return Err("AI 輸出包含未結束的 <think> 標籤且無有效內容".to_string());
            }
            return Ok(prefix.to_string());
        }
    }
    if lower.contains("</think>") {
        return Err("AI 輸出包含未成對的 </think> 標籤".to_string());
    }
    Ok(text.trim().to_string())
}

struct NumberLiteral {
    start: usize,
    end: usize,
    value: String,
}

fn number_literals(text: &str) -> Vec<NumberLiteral> {
    let chars: Vec<(usize, char)> = text.char_indices().collect();
    let digit_at = |i: usize| chars.get(i).is_some_and(|(_, c)| c.is_ascii_digit());
    let mut numbers = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        if !digit_at(i) {
            i += 1;
            continue;
        }
        let start = chars[i].0;
        let mut value = String::new();
        let mut seen_dot = false;
        while i < chars.len() {
            let ch = chars[i].1;
            if ch.is_ascii_digit() {
                value.push(ch);
            } else if ch == ',' && !seen_dot && (1..=3).all(|k| digit_at(i + k)) && !digit_at(i + 4)
            {
            } else if ch == '.' && !seen_dot && digit_at(i + 1) {
                value.push(ch);
                seen_dot = true;
            } else {
                break;
            }
            i += 1;
        }
        if seen_dot {
            value = value
                .trim_end_matches('0')
                .trim_end_matches('.')
                .to_string();
        }
        let end = chars.get(i).map_or(text.len(), |(offset, _)| *offset);
        numbers.push(NumberLiteral { start, end, value });
    }
    numbers
}

const SELF_CORRECTION_MARKERS: &[&str] = &[
    "不對",
    "不对",
    "說錯",
    "说错",
    "講錯",
    "讲错",
    "更正",
    "我是說",
    "我是说",
    "我的意思是",
    "更準確地說",
    "更准确地说",
];

fn corrected_away(
    input: &str,
    number: &NumberLiteral,
    input_numbers: &[NumberLiteral],
    output_values: &[String],
) -> bool {
    let rest = &input[number.end..];
    let Some(marker) = SELF_CORRECTION_MARKERS
        .iter()
        .filter_map(|marker| rest.find(marker))
        .min()
    else {
        return false;
    };
    if rest[..marker].contains(['。', '！', '？', '!', '?', '\n']) {
        return false;
    }
    let marker_offset = number.end + marker;
    !input_numbers
        .iter()
        .any(|other| other.start >= number.end && other.start < marker_offset)
        && input_numbers
            .iter()
            .any(|later| later.start > marker_offset && output_values.contains(&later.value))
}

pub fn validate_output_safety(input: &str, output: &str) -> Result<String, String> {
    let cleaned = strip_think_tags(output)?;
    if cleaned.is_empty() {
        return Err("AI 最佳化輸出為空".to_string());
    }
    let input_numbers = number_literals(input);
    let output_values: Vec<String> = number_literals(&cleaned)
        .into_iter()
        .map(|number| number.value)
        .collect();
    for number in &input_numbers {
        if !output_values.contains(&number.value)
            && !corrected_away(input, number, &input_numbers, &output_values)
        {
            return Err(format!(
                "AI 最佳化遺漏或竄改了輸入中的數值字面量: '{}'",
                number.value
            ));
        }
    }
    Ok(cleaned)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    #[test]
    fn builds_google_ai_and_openai_requests_with_normalized_urls() {
        let google_config = json!({
            "ai_provider": "google",
            "ai_api_key": "  AIzaSyTestKey  ",
            "ai_base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
            "ai_model": "gemini-2.5-flash"
        });
        let (url, key, model, body) =
            build_request_payload(&google_config, "測試", "optimize", true).unwrap();
        assert_eq!(
            url,
            "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
        );
        assert_eq!(key, "AIzaSyTestKey");
        assert_eq!(model, "gemini-2.5-flash");
        assert!(body.get("max_tokens").is_none());

        let openai_config = json!({
            "ai_api_key": "sk-test",
            "ai_base_url": "https://api.openai.com/v1/",
            "ai_model": "gpt-4o-mini"
        });
        let (o_url, _, o_model, o_body) =
            build_request_payload(&openai_config, "測試", "optimize", false).unwrap();
        assert_eq!(o_url, "https://api.openai.com/v1/chat/completions");
        assert_eq!(o_model, "gpt-4o-mini");
        assert_eq!(o_body["max_tokens"], json!(2000));
    }

    #[test]
    fn parses_google_ai_completion_and_error_array_responses() {
        let google_error = json!([
            {
                "error": {
                    "code": 400,
                    "message": "Please pass a valid API key",
                    "status": "INVALID_ARGUMENT"
                }
            }
        ]);
        let err =
            parse_completion_body(400, false, &google_error, "gemini-2.5-flash", true).unwrap_err();
        assert_eq!(err, "AI 請求失敗 (HTTP 400): Please pass a valid API key");

        let google_ok = json!({
            "id": "chatcmpl-123",
            "object": "chat.completion",
            "model": "gemini-2.5-flash",
            "choices": [
                {
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": "會議定在週四。\n"
                    },
                    "finish_reason": "stop"
                }
            ],
            "usage": {
                "prompt_tokens": 25,
                "completion_tokens": 5,
                "total_tokens": 30
            }
        });
        let optimized =
            parse_completion_body(200, true, &google_ok, "gemini-2.5-flash", false).unwrap();
        assert_eq!(optimized["success"], json!(true));
        assert_eq!(optimized["text"], json!("會議定在週四。"));
        assert_eq!(optimized["model"], json!("gemini-2.5-flash"));
    }

    #[test]
    fn end_to_end_complete_against_local_mock_server_for_test_and_optimize() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();

        let server = std::thread::spawn(move || {
            for expected in ["測試成功", "我覺得這個方案很好。"] {
                let (mut stream, _) = listener.accept().unwrap();
                let mut buf = [0u8; 8192];
                let n = stream.read(&mut buf).unwrap();
                let req_str = String::from_utf8_lossy(&buf[..n]);
                assert!(req_str.starts_with("POST /v1beta/openai/chat/completions HTTP/1.1"));
                assert!(req_str
                    .to_ascii_lowercase()
                    .contains("authorization: bearer aizasymockkey"));

                let response_json = json!({
                    "id": "chatcmpl-mock",
                    "object": "chat.completion",
                    "model": "gemini-2.5-flash",
                    "choices": [{
                        "index": 0,
                        "message": { "role": "assistant", "content": expected },
                        "finish_reason": "stop"
                    }],
                    "usage": { "prompt_tokens": 10, "completion_tokens": 4, "total_tokens": 14 }
                })
                .to_string();
                let http_response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    response_json.len(),
                    response_json
                );
                stream.write_all(http_response.as_bytes()).unwrap();
            }
        });

        let config = json!({
            "ai_provider": "google",
            "ai_api_key": "AIzaSyMockKey",
            "ai_base_url": format!("http://{addr}/v1beta/openai/"),
            "ai_model": "gemini-2.5-flash"
        });

        tauri::async_runtime::block_on(async move {
            let test_res = complete(config.clone(), "", "optimize", true)
                .await
                .unwrap();
            assert_eq!(test_res["available"], json!(true));
            assert_eq!(test_res["response"], json!("測試成功"));
            assert_eq!(test_res["model"], json!("gemini-2.5-flash"));

            let opt_res = complete(config, "呃我我我覺得這個方案很好", "optimize", false)
                .await
                .unwrap();
            assert_eq!(opt_res["success"], json!(true));
            assert_eq!(opt_res["text"], json!("我覺得這個方案很好。"));
        });

        server.join().unwrap();
    }

    #[test]
    fn ai_complete_converts_simplified_input_and_output_to_taiwan_traditional() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buf = [0u8; 4096];
            let n = stream.read(&mut buf).unwrap();
            let request = String::from_utf8_lossy(&buf[..n]).into_owned();
            let body = r#"{"choices":[{"message":{"content":"优化后的软体资料库与网络连线。"}}],"usage":{"total_tokens":12}}"#;
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            stream.write_all(response.as_bytes()).unwrap();
            request
        });

        let config = json!({
            "ai_api_key": "test-key",
            "ai_base_url": format!("http://{addr}/v1"),
            "ai_model": "test-model",
            "speech_language": "zh"
        });
        let result = tauri::async_runtime::block_on(complete(
            config,
            "这个软体的语音辨识结果应该要显示繁体中文。",
            "optimize",
            false,
        ))
        .unwrap();
        let request = server.join().unwrap();
        assert!(
            request.contains("這個軟體的語音辨識結果應該要顯示繁體中文。"),
            "prompt sent to AI should be converted to Traditional Chinese: {request}"
        );
        assert_eq!(result["text"], "最佳化後的軟體資料庫與網路連線。");
        assert_eq!(
            ququ_speech::convert_for_language("図書館で勉強する", "ja"),
            "図書館で勉強する"
        );
    }

    #[test]
    fn safety_validation_strips_think_tags_and_rejects_empty_or_broken_tags() {
        // Normal stripping
        let with_think = "<think>\nThinking about the text...\n</think>\n這是最佳化後的句子。";
        assert_eq!(
            strip_think_tags(with_think).unwrap(),
            "這是最佳化後的句子。"
        );

        // Multiple think tags
        let multiple = "<think>first</think>中間文字<think>second</think>結尾。";
        assert_eq!(strip_think_tags(multiple).unwrap(), "中間文字結尾。");

        // Lone closing tag
        assert!(strip_think_tags("孤立標籤</think>").is_err());

        // Think only -> empty result fails safety validation
        let think_only = "<think>只有思考沒有輸出</think>";
        assert!(validate_output_safety("測試", think_only).is_err());
    }

    #[test]
    fn safety_validation_ensures_input_numbers_and_literals_are_preserved() {
        let input = "訂單編號 9527，請在 2026 年 11 月 3 日前送達 100 件產品。";
        let preserved_output =
            "<think>保留所有數字</think>訂單編號 9527，請於 2026 年 11 月 3 日前送達 100 件產品。";
        let valid = validate_output_safety(input, preserved_output).unwrap();
        assert_eq!(
            valid,
            "訂單編號 9527，請於 2026 年 11 月 3 日前送達 100 件產品。"
        );

        // Tampered number (9527 -> 9528)
        let corrupted_number = "訂單編號 9528，請於 2026 年 11 月 3 日前送達 100 件產品。";
        let err = validate_output_safety(input, corrupted_number).unwrap_err();
        assert!(err.contains("9527"));

        // Dropped number (100 missing)
        let dropped_number = "訂單編號 9527，請於 2026 年 11 月 3 日前送達產品。";
        let err2 = validate_output_safety(input, dropped_number).unwrap_err();
        assert!(err2.contains("100"));

        // Substring collision: input has 3, output changed 3 to 4 but still contains 300
        let collision_input = "買 3 顆蘋果，共 300 元。";
        let collision_corrupted = "買 4 顆蘋果，共 300 元。";
        let err3 = validate_output_safety(collision_input, collision_corrupted).unwrap_err();
        assert!(err3.contains("3"));
    }

    #[test]
    fn safety_validation_accepts_equivalent_number_formatting() {
        assert!(validate_output_safety("共 1000 元", "共 1,000 元。").is_ok());
        assert!(validate_output_safety("共 1,000 元", "共 1000 元。").is_ok());
        assert!(validate_output_safety("增加 3.5 倍", "增加 3.50 倍。").is_ok());
        assert!(validate_output_safety("增加 3.0 倍", "增加 3 倍。").is_ok());
        assert!(validate_output_safety("共 1000 元", "共 1,001 元。").is_err());
        assert!(validate_output_safety("增加 3.5 倍", "增加 3.05 倍。").is_err());
        assert!(validate_output_safety("編號 1,2345", "編號 12345").is_err());
    }

    #[test]
    fn safety_validation_allows_numbers_removed_by_self_correction() {
        assert_eq!(
            validate_output_safety("會議定在3號，呃不對，是4號", "會議定在4號").unwrap(),
            "會議定在4號"
        );
        assert!(validate_output_safety("會議定在3號，呃不對，是4號", "會議定在3號").is_err());
        assert!(validate_output_safety("會議定在3號，呃不對，是週四", "會議定在週四").is_err());
        assert!(validate_output_safety("買3顆。不對，我說錯了是4顆", "我說錯了是4顆").is_err());
        assert!(validate_output_safety("房間5，會議定在3號，不對，是4號", "會議定在4號").is_err());
        assert!(
            validate_output_safety("房間5，請記下來。會議定在3號，不對，是4號", "會議定在4號")
                .is_err()
        );
    }
}
