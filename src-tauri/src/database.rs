use rusqlite::{params, Connection};
use serde_json::{json, Map, Value};
use std::path::Path;

pub struct Database(Connection);

impl Database {
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut connection = Connection::open(path).map_err(|e| e.to_string())?;
        connection
            .busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
        if path.exists() && path.metadata().map_err(|e| e.to_string())?.len() > 0 {
            let backup = path.with_extension("pre-rust.db");
            if !backup.exists() {
                let mut target = Connection::open(backup).map_err(|e| e.to_string())?;
                let backup = rusqlite::backup::Backup::new(&connection, &mut target)
                    .map_err(|e| e.to_string())?;
                backup
                    .run_to_completion(128, std::time::Duration::from_millis(10), None)
                    .map_err(|e| e.to_string())?;
            }
        }
        let transaction = connection.transaction().map_err(|e| e.to_string())?;
        transaction.execute_batch("CREATE TABLE IF NOT EXISTS transcriptions (
          id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, raw_text TEXT,
          processed_text TEXT, confidence REAL, language TEXT DEFAULT 'zh-CN', duration REAL,
          file_size INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);
          CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY,value TEXT,updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);
          CREATE TABLE IF NOT EXISTS special_words (id INTEGER PRIMARY KEY AUTOINCREMENT, word TEXT NOT NULL, replacement TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
          CREATE INDEX IF NOT EXISTS idx_transcriptions_created_at ON transcriptions(created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_special_words_id ON special_words(id DESC);")
          .map_err(|e| e.to_string())?;
        transaction.commit().map_err(|e| e.to_string())?;
        Ok(Self(connection))
    }
    pub fn get(&self, key: &str, default: Value) -> Result<Value, String> {
        use rusqlite::OptionalExtension;
        let stored: Option<String> = self
            .0
            .query_row("SELECT value FROM settings WHERE key=?", [key], |row| {
                row.get(0)
            })
            .optional()
            .map_err(|e| e.to_string())?;
        Ok(stored
            .map(|text| serde_json::from_str(&text).unwrap_or(Value::String(text)))
            .unwrap_or(default))
    }
    pub fn set(&self, key: &str, value: &Value) -> Result<Value, String> {
        let count = self.0.execute("INSERT OR REPLACE INTO settings(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)", params![key,value.to_string()]).map_err(|e| e.to_string())?;
        Ok(json!({"changes":count}))
    }
    pub fn all_settings(&self) -> Result<Value, String> {
        let mut result = Map::new();
        let mut statement = self
            .0
            .prepare("SELECT key,value FROM settings")
            .map_err(|e| e.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (key, text) = row.map_err(|e| e.to_string())?;
            result.insert(
                key,
                serde_json::from_str(&text).unwrap_or(Value::String(text)),
            );
        }
        Ok(Value::Object(result))
    }
    pub fn reset(&self) -> Result<Value, String> {
        self.execute("DELETE FROM settings", [])
    }
    pub fn save(&self, data: &Value) -> Result<Value, String> {
        let text = data["text"]
            .as_str()
            .filter(|s| !s.trim().is_empty())
            .or_else(|| data["raw_text"].as_str())
            .unwrap_or("")
            .trim();
        if text.is_empty() {
            return Err("轉錄文字不能為空".into());
        }
        self.0.execute("INSERT INTO transcriptions(text,raw_text,processed_text,confidence,language,duration,file_size) VALUES(?,?,?,?,?,?,?)",params![
          text,data["raw_text"].as_str(),data["processed_text"].as_str(),data["confidence"].as_f64().unwrap_or(0.0),
          data["language"].as_str().unwrap_or("zh-CN"),data["duration"].as_f64().unwrap_or(0.0),data["file_size"].as_i64().unwrap_or(0)
        ]).map_err(|e| e.to_string())?;
        Ok(json!({"lastInsertRowid":self.0.last_insert_rowid(),"changes":1}))
    }
    pub fn list(&self, limit: i64, offset: i64) -> Result<Value, String> {
        if !(1..=10000).contains(&limit) || offset < 0 {
            return Err("Invalid pagination".into());
        }
        let mut statement = self.0.prepare("SELECT id,text,raw_text,processed_text,confidence,language,duration,file_size,created_at,updated_at FROM transcriptions ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?").map_err(|e| e.to_string())?;
        let rows = statement.query_map(params![limit,offset], |r| Ok(json!({
          "id":r.get::<_,i64>(0)?,"text":r.get::<_,String>(1)?,"raw_text":r.get::<_,Option<String>>(2)?,
          "processed_text":r.get::<_,Option<String>>(3)?,"confidence":r.get::<_,Option<f64>>(4)?,
          "language":r.get::<_,Option<String>>(5)?,"duration":r.get::<_,Option<f64>>(6)?,"file_size":r.get::<_,Option<i64>>(7)?,
          "created_at":r.get::<_,String>(8)?,"updated_at":r.get::<_,String>(9)?
        }))).map_err(|e| e.to_string())?;
        Ok(Value::Array(
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?,
        ))
    }
    fn execute<const N: usize>(&self, sql: &str, values: [i64; N]) -> Result<Value, String> {
        let changes = self
            .0
            .execute(sql, rusqlite::params_from_iter(values))
            .map_err(|e| e.to_string())?;
        Ok(json!({"changes":changes}))
    }
    pub fn delete(&self, id: i64) -> Result<Value, String> {
        self.execute("DELETE FROM transcriptions WHERE id=?", [id])
    }
    pub fn clear(&self) -> Result<Value, String> {
        self.execute("DELETE FROM transcriptions", [])
    }
    pub fn update_transcription_text(&self, id: i64, text: &str) -> Result<Value, String> {
        let count = self
            .0
            .execute(
                "UPDATE transcriptions SET text=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
                params![text, id],
            )
            .map_err(|e| e.to_string())?;
        Ok(json!({"changes": count}))
    }
    pub fn get_special_words(&self) -> Result<Value, String> {
        let mut statement = self
            .0
            .prepare("SELECT id, word, replacement, created_at FROM special_words ORDER BY id DESC")
            .map_err(|e| e.to_string())?;
        let rows = statement
            .query_map([], |r| {
                Ok(json!({
                    "id": r.get::<_, i64>(0)?,
                    "word": r.get::<_, String>(1)?,
                    "replacement": r.get::<_, Option<String>>(2)?,
                    "created_at": r.get::<_, String>(3)?,
                }))
            })
            .map_err(|e| e.to_string())?;
        Ok(Value::Array(
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?,
        ))
    }
    pub fn save_special_word(&self, data: &Value) -> Result<Value, String> {
        use rusqlite::OptionalExtension;
        let word = data
            .get("word")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| "詞彙不能為空".to_string())?;
        let replacement = data
            .get("replacement")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty());
        let clear_replacement = data
            .get("replacement")
            .and_then(Value::as_str)
            .is_some_and(|s| s.trim().is_empty());

        let existing: Option<i64> = self
            .0
            .query_row("SELECT id FROM special_words WHERE word = ?", [word], |r| {
                r.get(0)
            })
            .optional()
            .map_err(|e| e.to_string())?;

        if let Some(id) = existing {
            self.0
                .execute(
                    "UPDATE special_words SET replacement = CASE WHEN ? THEN NULL ELSE COALESCE(?, replacement) END, created_at = CURRENT_TIMESTAMP WHERE id = ?",
                    params![clear_replacement, replacement, id],
                )
                .map_err(|e| e.to_string())?;
            let stored: Option<String> = self
                .0
                .query_row(
                    "SELECT replacement FROM special_words WHERE id = ?",
                    [id],
                    |r| r.get(0),
                )
                .map_err(|e| e.to_string())?;
            Ok(
                json!({"id": id, "word": word, "replacement": stored, "changes": 1, "updated": true}),
            )
        } else {
            self.0
                .execute(
                    "INSERT INTO special_words (word, replacement) VALUES (?, ?)",
                    params![word, replacement],
                )
                .map_err(|e| e.to_string())?;
            let id = self.0.last_insert_rowid();
            Ok(json!({"id": id, "word": word, "replacement": replacement, "changes": 1}))
        }
    }
    pub fn delete_special_word(&self, id: i64) -> Result<Value, String> {
        self.execute("DELETE FROM special_words WHERE id=?", [id])
    }
    pub fn delete_special_word_by_word(&self, word: &str) -> Result<Value, String> {
        let count = self
            .0
            .execute("DELETE FROM special_words WHERE word=?", [word])
            .map_err(|e| e.to_string())?;
        Ok(json!({"changes": count}))
    }
    #[cfg(test)]
    pub fn clear_special_words(&self) -> Result<Value, String> {
        self.execute("DELETE FROM special_words", [])
    }
    pub fn export_special_words(&self) -> Result<String, String> {
        let mut statement = self
            .0
            .prepare("SELECT word, replacement, created_at FROM special_words ORDER BY id ASC")
            .map_err(|e| e.to_string())?;
        let rows = statement
            .query_map([], |r| {
                Ok(json!({
                    "word": r.get::<_, String>(0)?,
                    "replacement": r.get::<_, Option<String>>(1)?,
                    "created_at": r.get::<_, String>(2)?,
                }))
            })
            .map_err(|e| e.to_string())?;
        let words = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        let payload = json!({
            "version": 1,
            "exported_at": chrono::Utc::now().to_rfc3339(),
            "words": words,
        });
        serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())
    }
    pub fn import_special_words(&self, content: &str) -> Result<Value, String> {
        let trimmed = content.trim_start_matches('\u{feff}').trim_start();
        struct Entry {
            word: String,
            replacement: Option<String>,
            created_at: Option<String>,
        }

        let mut entries = Vec::new();
        let mut invalid = 0usize;

        if !trimmed.starts_with('{') {
            return Err("無效的詞彙檔案：必須為匯出的 JSON 檔案".to_string());
        }
        {
            let root: Value =
                serde_json::from_str(trimmed).map_err(|e| format!("無效的 JSON 格式: {e}"))?;
            let obj = root
                .as_object()
                .ok_or_else(|| "詞彙檔案格式錯誤：根層級必須為物件".to_string())?;
            let version = match obj.get("version") {
                Some(Value::Number(n)) => n
                    .as_i64()
                    .ok_or_else(|| "詞彙檔案格式錯誤：版本號必須為整數".to_string())?,
                Some(_) => return Err("詞彙檔案格式錯誤：版本號必須為整數".to_string()),
                None => return Err("詞彙檔案格式錯誤：缺少版本號".to_string()),
            };
            if version > 1 {
                return Err(format!(
                    "不支援的檔案版本：版本 {version}（目前僅支援版本 1）"
                ));
            }
            if version < 1 {
                return Err("無效的檔案版本：版本號必須大於或等於 1".to_string());
            }

            let words = match obj.get("words") {
                Some(Value::Array(arr)) => arr,
                _ => return Err("詞彙檔案格式錯誤：words 欄位必須為陣列".to_string()),
            };

            for item in words {
                if let Some(item_obj) = item.as_object() {
                    let word_str = match item_obj.get("word").and_then(Value::as_str) {
                        Some(w) if !w.trim().is_empty() => w.trim().to_string(),
                        _ => {
                            invalid += 1;
                            continue;
                        }
                    };
                    let replacement = match item_obj.get("replacement") {
                        Some(Value::String(s)) => {
                            let s_trim = s.trim();
                            if s_trim.is_empty() {
                                None
                            } else {
                                Some(s_trim.to_string())
                            }
                        }
                        Some(Value::Null) | None => None,
                        Some(_) => {
                            invalid += 1;
                            continue;
                        }
                    };
                    let created_at = item_obj
                        .get("created_at")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|s| !s.is_empty())
                        .map(ToString::to_string);

                    entries.push(Entry {
                        word: word_str,
                        replacement,
                        created_at,
                    });
                } else {
                    invalid += 1;
                }
            }
        }

        use std::collections::HashSet;
        let mut existing_words: HashSet<String> = HashSet::new();
        {
            let mut stmt = self
                .0
                .prepare("SELECT word FROM special_words")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |r| r.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            for word in rows {
                existing_words.insert(word.map_err(|e| e.to_string())?);
            }
        }

        let mut added = 0usize;
        let mut skipped = 0usize;

        self.0
            .execute_batch("BEGIN TRANSACTION")
            .map_err(|e| e.to_string())?;
        let mut insert_stmt = match self.0.prepare(
            "INSERT INTO special_words (word, replacement, created_at) VALUES (?, ?, COALESCE(?, CURRENT_TIMESTAMP))",
        ) {
            Ok(stmt) => stmt,
            Err(e) => {
                let _ = self.0.execute_batch("ROLLBACK");
                return Err(e.to_string());
            }
        };

        for entry in entries {
            if existing_words.contains(&entry.word) {
                skipped += 1;
            } else {
                if let Err(e) =
                    insert_stmt.execute(params![entry.word, entry.replacement, entry.created_at])
                {
                    let _ = self.0.execute_batch("ROLLBACK");
                    return Err(e.to_string());
                }
                existing_words.insert(entry.word);
                added += 1;
            }
        }
        drop(insert_stmt);

        self.0.execute_batch("COMMIT").map_err(|e| e.to_string())?;

        Ok(json!({
            "added": added,
            "skipped": skipped,
            "invalid": invalid
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn legacy_data_survives_restart_and_backup() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("transcriptions.db");
        let old = Connection::open(&path).unwrap();
        old.execute_batch("CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT,updated_at DATETIME DEFAULT CURRENT_TIMESTAMP); INSERT INTO settings(key,value) VALUES('ai_model','\"legacy\"');").unwrap();
        drop(old);
        let db = Database::open(&path).unwrap();
        assert_eq!(db.get("ai_model", Value::Null).unwrap(), json!("legacy"));
        db.set("object", &json!({"enabled":false})).unwrap();
        db.save(&json!({"raw_text":"  中文測試  ","processed_text":"優化"}))
            .unwrap();
        drop(db);
        let db = Database::open(&path).unwrap();
        assert_eq!(
            db.get("object", Value::Null).unwrap(),
            json!({"enabled":false})
        );
        assert_eq!(db.list(1, 0).unwrap()[0]["text"], "中文測試");
        assert!(path.with_extension("pre-rust.db").exists());
    }
    #[test]
    fn rejects_blank_transcriptions_and_invalid_pagination() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(&dir.path().join("test.db")).unwrap();
        assert!(db.save(&json!({"text":"  "})).is_err());
        assert!(db.list(10, -1).is_err());
        assert!(db.list(0, 0).is_err());
        db.save(&json!({"text":"first"})).unwrap();
        db.save(&json!({"text":"second"})).unwrap();
        assert_eq!(db.list(1, 1).unwrap()[0]["text"], "first");
    }
    #[test]
    fn special_words_storage_and_replacement_pairs() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(&dir.path().join("test_words.db")).unwrap();

        // Rejects blank word
        assert!(db.save_special_word(&json!({"word": "   "})).is_err());

        // Saves plain word
        let saved_plain = db.save_special_word(&json!({"word": "王小明"})).unwrap();
        assert_eq!(saved_plain["word"], "王小明");
        assert!(saved_plain["replacement"].is_null());

        // Saves pair (word -> replacement)
        let saved_pair = db
            .save_special_word(&json!({"word": "庫伯內提斯", "replacement": "Kubernetes"}))
            .unwrap();
        assert_eq!(saved_pair["word"], "庫伯內提斯");
        assert_eq!(saved_pair["replacement"], "Kubernetes");

        // List words
        let list = db.get_special_words().unwrap();
        let arr = list.as_array().unwrap();
        assert_eq!(arr.len(), 2);
        assert_eq!(arr[0]["word"], "庫伯內提斯");
        assert_eq!(arr[0]["replacement"], "Kubernetes");
        assert_eq!(arr[1]["word"], "王小明");
        assert!(arr[1]["replacement"].is_null());

        // Updating existing word
        let updated = db
            .save_special_word(&json!({"word": "王小明", "replacement": "Xiao-Ming Wang"}))
            .unwrap();
        assert_eq!(updated["updated"], true);
        let list = db.get_special_words().unwrap();
        assert_eq!(list.as_array().unwrap().len(), 2);

        // Re-saving without a replacement keeps the stored pair
        let kept = db
            .save_special_word(&json!({"word": "庫伯內提斯"}))
            .unwrap();
        assert_eq!(kept["replacement"], "Kubernetes");
        let list = db.get_special_words().unwrap();
        assert_eq!(
            list.as_array()
                .unwrap()
                .iter()
                .find(|w| w["word"] == "庫伯內提斯")
                .unwrap()["replacement"],
            "Kubernetes"
        );

        // An explicit empty replacement turns the pair into a plain word
        let cleared = db
            .save_special_word(&json!({"word": "庫伯內提斯", "replacement": "  "}))
            .unwrap();
        assert!(cleared["replacement"].is_null());
        let list = db.get_special_words().unwrap();
        assert!(list
            .as_array()
            .unwrap()
            .iter()
            .find(|w| w["word"] == "庫伯內提斯")
            .unwrap()["replacement"]
            .is_null());

        // Delete special word by id
        let id = saved_pair["id"].as_i64().unwrap();
        db.delete_special_word(id).unwrap();
        let list_after = db.get_special_words().unwrap();
        assert_eq!(list_after.as_array().unwrap().len(), 1);
        assert_eq!(list_after.as_array().unwrap()[0]["word"], "王小明");

        // Delete by word string
        db.delete_special_word_by_word("王小明").unwrap();
        assert_eq!(db.get_special_words().unwrap().as_array().unwrap().len(), 0);
    }
    #[test]
    fn update_transcription_text_modifies_record() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(&dir.path().join("test_tx.db")).unwrap();
        let saved = db
            .save(&json!({"text": "庫伯內提斯在邊緣裝置上的部署。"}))
            .unwrap();
        let id = saved["lastInsertRowid"].as_i64().unwrap();
        db.update_transcription_text(id, "Kubernetes在邊緣裝置上的部署。")
            .unwrap();
        let list = db.list(1, 0).unwrap();
        assert_eq!(list[0]["text"], "Kubernetes在邊緣裝置上的部署。");
    }
    #[test]
    fn special_words_export_empty_list_produces_valid_json() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(&dir.path().join("test_empty_export.db")).unwrap();
        let exported = db.export_special_words().unwrap();
        let val: Value = serde_json::from_str(&exported).unwrap();
        assert_eq!(val["version"], 1);
        assert!(val["exported_at"].is_string());
        assert_eq!(val["words"].as_array().unwrap().len(), 0);
    }
    #[test]
    fn special_words_round_trip_json() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(&dir.path().join("test_roundtrip.db")).unwrap();
        db.save_special_word(&json!({"word": "王小明"})).unwrap();
        db.save_special_word(&json!({"word": "庫伯內提斯", "replacement": "Kubernetes"}))
            .unwrap();

        let exported = db.export_special_words().unwrap();
        db.clear_special_words().unwrap();
        assert_eq!(db.get_special_words().unwrap().as_array().unwrap().len(), 0);

        let summary = db.import_special_words(&exported).unwrap();
        assert_eq!(summary["added"], 2);
        assert_eq!(summary["skipped"], 0);
        assert_eq!(summary["invalid"], 0);

        let list = db.get_special_words().unwrap();
        let arr = list.as_array().unwrap();
        assert_eq!(arr.len(), 2);
        let pair = arr.iter().find(|w| w["word"] == "庫伯內提斯").unwrap();
        assert_eq!(pair["replacement"], "Kubernetes");
        let plain = arr.iter().find(|w| w["word"] == "王小明").unwrap();
        assert!(plain["replacement"].is_null());
    }
    #[test]
    fn special_words_import_rejects_non_json_and_strips_bom() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(&dir.path().join("test_plain.db")).unwrap();

        assert!(db
            .import_special_words("庫伯內提斯 => Kubernetes\n蛐蛐")
            .is_err());
        assert!(db.import_special_words("[{\"word\":\"test\"}]").is_err());
        assert_eq!(db.get_special_words().unwrap().as_array().unwrap().len(), 0);

        let bom_json = format!(
            "\u{feff}{}",
            json!({"version": 1, "words": [{"word": "蛐蛐"}]})
        );
        let summary = db.import_special_words(&bom_json).unwrap();
        assert_eq!(summary["added"], 1);
        let list = db.get_special_words().unwrap();
        assert_eq!(list.as_array().unwrap()[0]["word"], "蛐蛐");
    }
    #[test]
    fn special_words_deduplication_and_conflicts() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(&dir.path().join("test_dedup.db")).unwrap();
        db.save_special_word(&json!({"word": "庫伯內提斯", "replacement": "K8s"}))
            .unwrap();

        let json_content = json!({
            "version": 1,
            "exported_at": "2026-10-30T00:00:00Z",
            "words": [
                {"word": "庫伯內提斯", "replacement": "Kubernetes"}, // existing with different replacement -> keep existing
                {"word": "王小明", "replacement": "Xiao-Ming"}, // new
                {"word": "王小明", "replacement": "Other"}, // duplicate in same file -> skip
            ]
        })
        .to_string();

        let summary = db.import_special_words(&json_content).unwrap();
        assert_eq!(summary["added"], 1);
        assert_eq!(summary["skipped"], 2);
        assert_eq!(summary["invalid"], 0);

        let list = db.get_special_words().unwrap();
        let arr = list.as_array().unwrap();
        assert_eq!(arr.len(), 2);
        let k8s = arr.iter().find(|w| w["word"] == "庫伯內提斯").unwrap();
        assert_eq!(k8s["replacement"], "K8s"); // Existing wins!
        let ming = arr.iter().find(|w| w["word"] == "王小明").unwrap();
        assert_eq!(ming["replacement"], "Xiao-Ming");
    }
    #[test]
    fn special_words_import_malformed_and_versioning() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(&dir.path().join("test_malformed.db")).unwrap();

        // Malformed JSON syntax
        assert!(db.import_special_words("{ invalid json ").is_err());

        // Root is array instead of object
        assert!(db.import_special_words("[{\"word\":\"test\"}]").is_err());

        // Missing version
        assert!(db.import_special_words("{\"words\":[]}").is_err());

        // Unsupported newer version
        let err_v2 = db
            .import_special_words("{\"version\":2,\"words\":[]}")
            .unwrap_err();
        assert!(err_v2.contains("不支援的檔案版本"));
        assert!(err_v2.contains("2"));

        // Missing words array
        assert!(db.import_special_words("{\"version\":1}").is_err());

        // Forward compatibility: unknown fields tolerated; invalid items counted in invalid
        let json_with_unknown = json!({
            "version": 1,
            "client_name": "future_client",
            "words": [
                {"word": "Valid", "replacement": "OK", "extra_meta": 123},
                {"invalid_entry": true},
                {"word": "   "},
                {"word": "AnotherValid", "replacement": 12345} // invalid replacement type
            ]
        })
        .to_string();

        let summary = db.import_special_words(&json_with_unknown).unwrap();
        assert_eq!(summary["added"], 1);
        assert_eq!(summary["skipped"], 0);
        assert_eq!(summary["invalid"], 3);
    }
}
