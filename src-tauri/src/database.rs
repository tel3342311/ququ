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
          CREATE INDEX IF NOT EXISTS idx_transcriptions_created_at ON transcriptions(created_at DESC);")
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
}
