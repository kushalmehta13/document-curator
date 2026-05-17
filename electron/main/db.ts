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

  if (version < 2) {
    const cols = database.prepare(`PRAGMA table_info(documents)`).all() as Array<{ name: string }>
    const hasAnalysis = cols.some((c) => c.name === 'analysis')
    if (!hasAnalysis) {
      database.exec(`ALTER TABLE documents ADD COLUMN analysis TEXT`)
    }
    database.prepare('UPDATE schema_version SET version = 2').run()
  }

  if (version < 3) {
    const oldBirth = JSON.stringify(['birth', 'certificate'])
    const oldDiploma = JSON.stringify(['diploma', 'degree', 'graduation'])
    const rowBirth = database
      .prepare(`SELECT keywords FROM categories WHERE slug = 'birth_certificate'`)
      .get() as { keywords: string } | undefined
    if (rowBirth?.keywords === oldBirth) {
      database
        .prepare(`UPDATE categories SET keywords = ? WHERE slug = 'birth_certificate'`)
        .run(
          JSON.stringify([
            'birth',
            'birth certificate',
            'vital records',
            'registry of vital',
            'certify birth'
          ])
        )
    }
    const rowDip = database
      .prepare(`SELECT keywords FROM categories WHERE slug = 'academic_diploma'`)
      .get() as { keywords: string } | undefined
    if (rowDip?.keywords === oldDiploma) {
      database
        .prepare(`UPDATE categories SET keywords = ? WHERE slug = 'academic_diploma'`)
        .run(
          JSON.stringify([
            'diploma',
            'degree',
            'graduation',
            'bachelor',
            'master',
            'university',
            'college',
            'degree certificate',
            'graduation certificate'
          ])
        )
    }
    database.prepare('UPDATE schema_version SET version = 3').run()
  }

  if (version < 4) {
    const cols = database.prepare(`PRAGMA table_info(documents)`).all() as Array<{ name: string }>
    const hasFiling = cols.some((c) => c.name === 'filing_name')
    if (!hasFiling) {
      database.exec(`ALTER TABLE documents ADD COLUMN filing_name TEXT`)
    }
    database.prepare('UPDATE schema_version SET version = 4').run()
  }

  if (version < 5) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL CHECK (kind IN ('person', 'family', 'pet')),
        color TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS profile_members (
        family_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        member_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        PRIMARY KEY (family_id, member_id)
      );

      CREATE INDEX IF NOT EXISTS idx_pm_family ON profile_members(family_id);
      CREATE INDEX IF NOT EXISTS idx_pm_member ON profile_members(member_id);
    `)
    const cols = database.prepare(`PRAGMA table_info(documents)`).all() as Array<{ name: string }>
    const hasProfile = cols.some((c) => c.name === 'profile_id')
    if (!hasProfile) {
      database.exec(`ALTER TABLE documents ADD COLUMN profile_id INTEGER REFERENCES profiles(id)`)
      database.exec(`CREATE INDEX IF NOT EXISTS idx_documents_profile ON documents(profile_id)`)
    }
    database.prepare('UPDATE schema_version SET version = 5').run()
  }

  if (version < 6) {
    // SQLite can't drop CHECK constraints in place; rebuild profiles to allow kind='pet'
    // and seed pet-related categories. Existing rows are preserved.
    const existing = database
      .prepare(`SELECT kind FROM profiles LIMIT 1`)
      .all()
    void existing
    const tableInfo = database
      .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='profiles'`)
      .get() as { sql: string } | undefined
    if (tableInfo && !/'pet'/.test(tableInfo.sql)) {
      // FK enforcement must be off OUTSIDE a transaction; otherwise dropping `profiles`
      // breaks profile_members.family_id / documents.profile_id refs mid-migration.
      database.pragma('foreign_keys = OFF')
      database.exec('BEGIN')
      try {
        database.exec(`
          CREATE TABLE profiles_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            slug TEXT NOT NULL UNIQUE,
            kind TEXT NOT NULL CHECK (kind IN ('person', 'family', 'pet')),
            color TEXT,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          INSERT INTO profiles_new (id, name, slug, kind, color, sort_order, created_at)
            SELECT id, name, slug, kind, color, sort_order, created_at FROM profiles;
          DROP TABLE profiles;
          ALTER TABLE profiles_new RENAME TO profiles;
        `)
        database.exec('COMMIT')
      } catch (e) {
        database.exec('ROLLBACK')
        throw e
      } finally {
        database.pragma('foreign_keys = ON')
      }
    }

    type PetCat = {
      name: string
      slug: string
      path_template: string
      keywords: string[]
      metadata_schema: Array<{ key: string; label: string }>
    }
    const PET_CATEGORIES: PetCat[] = [
      {
        name: 'Pet — vaccination record',
        slug: 'pet_vaccination',
        path_template: 'Pet/Vaccinations/{pet}',
        keywords: ['vaccination', 'vaccine', 'rabies', 'distemper', 'bordetella', 'immunization'],
        metadata_schema: [
          { key: 'pet', label: 'Pet name' },
          { key: 'vaccine', label: 'Vaccine' },
          { key: 'issue_date', label: 'Date administered' },
          { key: 'expiry', label: 'Booster due' },
          { key: 'veterinarian', label: 'Veterinarian / clinic' }
        ]
      },
      {
        name: 'Pet — medical record',
        slug: 'pet_medical',
        path_template: 'Pet/Medical/{pet}',
        keywords: ['veterinary', 'vet visit', 'medical record', 'lab results', 'treatment', 'diagnosis'],
        metadata_schema: [
          { key: 'pet', label: 'Pet name' },
          { key: 'visit_date', label: 'Visit date' },
          { key: 'reason', label: 'Reason / diagnosis' },
          { key: 'veterinarian', label: 'Veterinarian / clinic' }
        ]
      },
      {
        name: 'Pet — adoption / registration',
        slug: 'pet_registration',
        path_template: 'Pet/Registration/{pet}',
        keywords: ['adoption', 'pedigree', 'registration', 'breeder', 'akc', 'shelter', 'license tag'],
        metadata_schema: [
          { key: 'pet', label: 'Pet name' },
          { key: 'breed', label: 'Breed' },
          { key: 'birth_date', label: 'Date of birth' },
          { key: 'registration_number', label: 'Registration / tag #' },
          { key: 'issued_by', label: 'Issued by' }
        ]
      },
      {
        name: 'Pet — microchip',
        slug: 'pet_microchip',
        path_template: 'Pet/Microchip/{pet}',
        keywords: ['microchip', 'chip number', 'avid', 'home again', 'petlink'],
        metadata_schema: [
          { key: 'pet', label: 'Pet name' },
          { key: 'chip_number', label: 'Microchip number' },
          { key: 'registry', label: 'Registry' },
          { key: 'issue_date', label: 'Date implanted' }
        ]
      },
      {
        name: 'Pet — insurance',
        slug: 'pet_insurance',
        path_template: 'Pet/Insurance/{pet}',
        keywords: ['pet insurance', 'policy', 'coverage', 'trupanion', 'healthy paws', 'embrace'],
        metadata_schema: [
          { key: 'pet', label: 'Pet name' },
          { key: 'insurer', label: 'Insurer' },
          { key: 'policy_number', label: 'Policy number' },
          { key: 'issue_date', label: 'Effective date' },
          { key: 'expiry', label: 'Renewal date' }
        ]
      }
    ]

    const existingSlugs = new Set(
      (database.prepare(`SELECT slug FROM categories`).all() as Array<{ slug: string }>).map(
        (r) => r.slug
      )
    )
    const ins = database.prepare(`
      INSERT INTO categories (name, slug, path_template, keywords, metadata_schema)
      VALUES (@name, @slug, @path_template, @keywords, @metadata_schema)
    `)
    for (const c of PET_CATEGORIES) {
      if (existingSlugs.has(c.slug)) continue
      ins.run({
        name: c.name,
        slug: c.slug,
        path_template: c.path_template,
        keywords: JSON.stringify(c.keywords),
        metadata_schema: JSON.stringify(c.metadata_schema)
      })
    }

    database.prepare('UPDATE schema_version SET version = 6').run()
  }
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}
