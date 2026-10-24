use serde_json::{json, Value};

pub async fn complete(config: Value, text: &str, mode: &str, test: bool) -> Result<Value, String> {
    let key = config["ai_api_key"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or("请先配置 AI API 密钥")?;
    let base = config["ai_base_url"]
        .as_str()
        .filter(|s| !s.is_empty())
        .unwrap_or("https://api.openai.com/v1")
        .trim_end_matches('/');
    let model = config["ai_model"]
        .as_str()
        .filter(|s| !s.is_empty())
        .unwrap_or("gpt-3.5-turbo");
    let prompts: Value =
        serde_json::from_str(include_str!("../prompts.json")).map_err(|e| e.to_string())?;
    let prompt = if test {
        "请回复测试成功".to_string()
    } else {
        prompts[mode]
            .as_str()
            .or_else(|| prompts["optimize"].as_str())
            .ok_or("Missing prompt")?
            .replace("__QUQU_INPUT_TEXT__", text)
    };
    let response=reqwest::Client::builder().timeout(std::time::Duration::from_secs(60)).build().map_err(|e|e.to_string())?
        .post(format!("{base}/chat/completions")).bearer_auth(key)
        .json(&json!({"model":model,"messages":[{"role":"user","content":prompt}],"temperature":0.3,"max_tokens":if test {50}else{2000},"stream":false}))
        .send().await.map_err(|_|"无法连接 AI 服务，请检查地址与网络".to_string())?;
    let status = response.status();
    let body: Value = response
        .json()
        .await
        .map_err(|_| "AI 服务返回了无效 JSON".to_string())?;
    if !status.is_success() {
        return Err(format!("AI 请求失败 (HTTP {})", status.as_u16()));
    }
    let content = body["choices"][0]["message"]["content"]
        .as_str()
        .ok_or("AI 返回格式错误")?
        .trim();
    Ok(if test {
        json!({"available":true,"success":true,"message":"测试成功","model":model})
    } else {
        json!({"success":true,"text":content,"usage":body["usage"],"model":model})
    })
}
