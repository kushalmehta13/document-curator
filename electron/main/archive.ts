import { createHash } from 'crypto'
import { copyFile, mkdir, readFile, stat, writeFile, readdir } from 'fs/promises'
import { createReadStream } from 'fs'
import { join, extname } from 'path'

export const ARCHIVE_VERSION = 1
export const MANIFEST_NAME = 'manifest.json'
export const FILES_DIR = 'files'

export type ArchiveProfile = {
  slug: string
  name: string
  kind: 'person' | 'family' | 'pet'
  color: string | null
  members: string[] // member slugs
}

export type ArchiveCategory = {
  slug: string
  name: string
  path_template: string
  keywords: unknown
  metadata_schema: unknown
}

export type ArchiveBundleTemplate = {
  external_id: string
  name: string
  description: string | null
  items: Array<{
    category_slug: string
    label: string
    required: number
    sort_order: number
  }>
}

export type ArchiveDocument = {
  hash: string
  /** Original-extension stored with the file (e.g. 'pdf'). */
  ext: string
  /** Filename stem when filed (no extension). */
  filing_name: string | null
  original_name: string
  /** Resolved relative path within the documentsRoot when this archive was created. */
  relative_path: string | null
  category_slug: string | null
  profile_slug: string | null
  metadata: Record<string, string>
  template_vars: Record<string, string>
  status: 'draft' | 'complete'
}

export type ArchiveBundle = {
  external_template_id: string
  name: string
  attachments: Array<{
    document_hash: string
    template_item_label: string
  }>
}

export type ArchiveManifest = {
  version: number
  exportedAt: string
  app: 'document-cabinet'
  profiles: ArchiveProfile[]
  categories: ArchiveCategory[]
  bundle_templates: ArchiveBundleTemplate[]
  documents: ArchiveDocument[]
  bundles: ArchiveBundle[]
}

/** Stream-hash a file to SHA-256 hex; safe for large PDFs. */
export async function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    const s = createReadStream(filePath)
    s.on('error', reject)
    s.on('data', (chunk) => h.update(chunk))
    s.on('end', () => resolve(h.digest('hex')))
  })
}

export function fileExt(p: string): string {
  return extname(p).replace(/^\./, '').toLowerCase()
}

export async function ensureArchiveLayout(rootDir: string): Promise<void> {
  await mkdir(rootDir, { recursive: true })
  await mkdir(join(rootDir, FILES_DIR), { recursive: true })
}

export async function writeManifest(rootDir: string, manifest: ArchiveManifest): Promise<void> {
  await writeFile(join(rootDir, MANIFEST_NAME), JSON.stringify(manifest, null, 2), 'utf-8')
}

export async function readManifest(rootDir: string): Promise<ArchiveManifest> {
  const raw = await readFile(join(rootDir, MANIFEST_NAME), 'utf-8')
  const parsed = JSON.parse(raw) as ArchiveManifest
  if (!parsed || parsed.app !== 'document-cabinet') {
    throw new Error('Not a Document Cabinet archive (missing app marker).')
  }
  if (typeof parsed.version !== 'number' || parsed.version > ARCHIVE_VERSION) {
    throw new Error(`Archive version ${parsed.version} is newer than this app supports (${ARCHIVE_VERSION}).`)
  }
  return parsed
}

export async function copyIntoArchive(
  rootDir: string,
  sourcePath: string,
  hash: string,
  ext: string
): Promise<string> {
  const dest = join(rootDir, FILES_DIR, ext ? `${hash}.${ext}` : hash)
  try {
    await stat(dest)
    return dest // already there (same content)
  } catch {
    /* not there */
  }
  await copyFile(sourcePath, dest)
  return dest
}

export async function findArchiveFile(
  rootDir: string,
  hash: string,
  ext: string | null
): Promise<string | null> {
  const dir = join(rootDir, FILES_DIR)
  if (ext) {
    const candidate = join(dir, `${hash}.${ext}`)
    try {
      await stat(candidate)
      return candidate
    } catch {
      /* fall through to directory scan */
    }
  }
  try {
    const entries = await readdir(dir)
    const match = entries.find((e) => e.startsWith(hash))
    return match ? join(dir, match) : null
  } catch {
    return null
  }
}
