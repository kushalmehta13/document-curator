import Database from 'better-sqlite3'
import { join } from 'path'
import type { App } from 'electron'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized')
  return db
}

export function initDb(app: App): void {
  const userData = app.getPath('userData')
  const dbPath = join(userData, 'curator.db')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  migrate(db)
}

function migrate(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);
  `)
  const count = database.prepare('SELECT COUNT(*) as c FROM schema_version').get() as { c: number }
  if (count.c === 0) {
    database.prepare('INSERT INTO schema_version (version) VALUES (0)').run()
  }
  const version = (
    database.prepare('SELECT version FROM schema_version LIMIT 1').get() as { version: number }
  ).version

  if (version < 1) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        path_template TEXT NOT NULL,
        keywords TEXT,
        metadata_schema TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category_id INTEGER REFERENCES categories(id),
        original_name TEXT NOT NULL,
        stored_path TEXT NOT NULL,
        inbox_path TEXT,
        status TEXT NOT NULL CHECK (status IN ('draft', 'complete')),
        metadata TEXT NOT NULL DEFAULT '{}',
        template_vars TEXT,
        ocr_status TEXT,
        ocr_raw TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
      CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(category_id);

      CREATE TABLE IF NOT EXISTS bundle_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        external_id TEXT UNIQUE,
        name TEXT NOT NULL,
        description TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS bundle_template_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        template_id INTEGER NOT NULL REFERENCES bundle_templates(id) ON DELETE CASCADE,
        category_slug TEXT NOT NULL,
        label TEXT NOT NULL,
        required INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_bti_template ON bundle_template_items(template_id);

      CREATE TABLE IF NOT EXISTS bundles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        template_id INTEGER NOT NULL REFERENCES bundle_templates(id),
        name TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS bundle_documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bundle_id INTEGER NOT NULL REFERENCES bundles(id) ON DELETE CASCADE,
        document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        template_item_id INTEGER REFERENCES bundle_template_items(id)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_bd_slot ON bundle_documents(bundle_id, template_item_id);
      CREATE INDEX IF NOT EXISTS idx_bd_bundle ON bundle_documents(bundle_id);
    `)
    database.prepare('UPDATE schema_version SET version = 1').run()
  }
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}
