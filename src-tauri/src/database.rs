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
            return Err("转录文本不能为空".into());
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

        let existing: Option<i64> = self
            .0
            .query_row(
                "SELECT id FROM special_words WHERE word = ?",
                [word],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        if let Some(id) = existing {
            self.0
                .execute(
                    "UPDATE special_words SET replacement = ?, created_at = CURRENT_TIMESTAMP WHERE id = ?",
                    params![replacement, id],
                )
                .map_err(|e| e.to_string())?;
            Ok(json!({"id": id, "word": word, "replacement": replacement, "changes": 1, "updated": true}))
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
    pub fn clear_special_words(&self) -> Result<Value, String> {
        self.execute("DELETE FROM special_words", [])
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
}
