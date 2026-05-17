<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

type Profile = {
  id: number
  name: string
  slug: string
  kind: 'person' | 'family' | 'pet'
  color: string | null
  sort_order: number
  created_at: string
  members: number[]
}

const documentsRoot = ref('')
const fileMode = ref<'copy' | 'move'>('copy')
const msg = ref('')
const profiles = ref<Profile[]>([])
const newProfileName = ref('')
const newProfileKind = ref<'person' | 'family' | 'pet'>('person')
const familyMembersDraft = ref<Record<number, Set<number>>>({})

const categories = ref<
  Array<{
    id: number
    name: string
    slug: string
    path_template: string
    keywords: string | null
    metadata_schema: string | null
  }>
>([])

const newCat = ref({
  name: '',
  slug: '',
  path_template: '',
  keywords: ''
})
const newCatSchema = ref<Array<{ key: string; label: string }>>([{ key: '', label: '' }])

async function load() {
  const s = await window.api.settings.get()
  documentsRoot.value = s.documentsRoot
  fileMode.value = s.fileMode
  categories.value = (await window.api.categories.list()) as typeof categories.value
  profiles.value = (await window.api.profiles.list()) as Profile[]
  const draft: Record<number, Set<number>> = {}
  for (const p of profiles.value) {
    if (p.kind === 'family') draft[p.id] = new Set(p.members)
  }
  familyMembersDraft.value = draft
}

const personProfiles = computed(() =>
  profiles.value.filter((p) => p.kind === 'person' || p.kind === 'pet')
)

/* ----------------------------- backup / restore ---------------------------- */

type ImportRow = {
  hash: string
  ext: string
  original_name: string
  filing_name: string | null
  category_slug: string | null
  category_name: string | null
  profile_slug: string | null
  profile_name: string | null
  status: 'draft' | 'complete'
  duplicate_kind: 'none' | 'same_spot' | 'different_spot'
  recommended_action: 'import' | 'skip'
  reason: string
  existing: Array<{
    id: number
    stored_path: string
    profile_name: string | null
    category_name: string | null
  }>
}

const backupBusy = ref(false)
const importPlan = ref<{
  archive_dir: string
  exported_at: string
  rows: ImportRow[]
  totals: { total: number; new: number; same_spot: number; different_spot: number }
} | null>(null)
const importDecisions = ref<Map<string, 'import' | 'skip'>>(new Map())
const showImportModal = ref(false)
const importResult = ref<{
  imported: number
  skipped: number
  bundlesImported: number
  errors: Array<{ hash: string; message: string }>
} | null>(null)
const dupFilter = ref<'all' | 'duplicates'>('all')

async function runExport() {
  backupBusy.value = true
  msg.value = ''
  try {
    const r = await window.api.archive.export({ includeDrafts: false })
    if (!r.ok) {
      if ('canceled' in r && r.canceled) return
      msg.value = 'Export was not completed.'
      return
    }
    msg.value = `Exported ${r.counts.documents} documents, ${r.counts.profiles} profiles, ${r.counts.categories} categories, ${r.counts.bundles} bundles to ${r.dir}${r.counts.copyErrors ? ` (${r.counts.copyErrors} files could not be read)` : ''}.`
  } catch (e) {
    msg.value = e instanceof Error ? e.message : 'Export failed'
  } finally {
    backupBusy.value = false
  }
}

async function startImport() {
  backupBusy.value = true
  msg.value = ''
  try {
    const r = await window.api.archive.importPreview()
    if (!r.ok) {
      if ('canceled' in r && r.canceled) return
      msg.value = 'Could not read that archive.'
      return
    }
    importPlan.value = r.plan
    const decisions = new Map<string, 'import' | 'skip'>()
    for (const row of r.plan.rows) {
      decisions.set(row.hash, row.recommended_action)
    }
    importDecisions.value = decisions
    dupFilter.value = r.plan.totals.same_spot + r.plan.totals.different_spot > 0 ? 'duplicates' : 'all'
    showImportModal.value = true
    importResult.value = null
  } catch (e) {
    msg.value = e instanceof Error ? e.message : 'Import preview failed'
  } finally {
    backupBusy.value = false
  }
}

const visibleRows = computed(() => {
  if (!importPlan.value) return []
  if (dupFilter.value === 'duplicates') {
    return importPlan.value.rows.filter((r) => r.duplicate_kind !== 'none')
  }
  return importPlan.value.rows
})

const importCounts = computed(() => {
  let imp = 0
  let skip = 0
  for (const v of importDecisions.value.values()) {
    if (v === 'import') imp++
    else skip++
  }
  return { imp, skip }
})

function setDecision(hash: string, action: 'import' | 'skip') {
  const next = new Map(importDecisions.value)
  next.set(hash, action)
  importDecisions.value = next
}

function applyRecommendedAll() {
  if (!importPlan.value) return
  const next = new Map<string, 'import' | 'skip'>()
  for (const row of importPlan.value.rows) next.set(row.hash, row.recommended_action)
  importDecisions.value = next
}

function setAll(action: 'import' | 'skip') {
  if (!importPlan.value) return
  const next = new Map(importDecisions.value)
  for (const row of visibleRows.value) next.set(row.hash, action)
  importDecisions.value = next
}

async function applyImport() {
  if (!importPlan.value) return
  backupBusy.value = true
  msg.value = ''
  try {
    const decisions = Array.from(importDecisions.value.entries()).map(([hash, action]) => ({
      hash,
      action
    }))
    const r = await window.api.archive.importApply({
      archive_dir: importPlan.value.archive_dir,
      decisions
    })
    importResult.value = {
      imported: r.imported,
      skipped: r.skipped,
      bundlesImported: r.bundlesImported,
      errors: r.errors
    }
    msg.value = `Imported ${r.imported} document${r.imported === 1 ? '' : 's'}, skipped ${r.skipped}.`
    await load()
    window.dispatchEvent(new CustomEvent('cabinet:profile-changed'))
  } catch (e) {
    msg.value = e instanceof Error ? e.message : 'Import failed'
  } finally {
    backupBusy.value = false
  }
}

function closeImportModal() {
  showImportModal.value = false
  importPlan.value = null
  importDecisions.value = new Map()
  importResult.value = null
}

function dupBadgeText(kind: 'none' | 'same_spot' | 'different_spot'): string {
  if (kind === 'same_spot') return 'Already filed'
  if (kind === 'different_spot') return 'Same content elsewhere'
  return 'New'
}

async function addProfile() {
  const name = newProfileName.value.trim()
  if (!name) {
    msg.value = 'Profile name is required'
    return
  }
  await window.api.profiles.create({ name, kind: newProfileKind.value })
  newProfileName.value = ''
  msg.value = `Added ${newProfileKind.value === 'family' ? 'family' : 'profile'} “${name}”`
  await load()
  window.dispatchEvent(new CustomEvent('cabinet:profile-changed'))
  setTimeout(() => (msg.value = ''), 2000)
}

async function renameProfile(p: Profile) {
  const next = window.prompt(`Rename “${p.name}”`, p.name)
  if (next == null) return
  const trimmed = next.trim()
  if (!trimmed || trimmed === p.name) return
  await window.api.profiles.update(p.id, { name: trimmed })
  await load()
  window.dispatchEvent(new CustomEvent('cabinet:profile-changed'))
}

async function removeProfile(p: Profile) {
  if (!confirm(`Delete profile “${p.name}”? This cannot be undone.`)) return
  const r = await window.api.profiles.delete(p.id)
  if (!r.ok) {
    msg.value = r.error || 'Could not delete'
    return
  }
  msg.value = `Deleted “${p.name}”`
  await load()
  window.dispatchEvent(new CustomEvent('cabinet:profile-changed'))
  setTimeout(() => (msg.value = ''), 2000)
}

async function toggleFamilyMember(familyId: number, memberId: number) {
  const set = new Set(familyMembersDraft.value[familyId] || [])
  if (set.has(memberId)) set.delete(memberId)
  else set.add(memberId)
  familyMembersDraft.value = { ...familyMembersDraft.value, [familyId]: set }
  try {
    await window.api.profiles.setMembers(familyId, Array.from(set))
    window.dispatchEvent(new CustomEvent('cabinet:profile-changed'))
  } catch (e) {
    msg.value = e instanceof Error ? e.message : 'Could not update members'
  }
}

onMounted(load)

async function saveSettings() {
  await window.api.settings.set({
    documentsRoot: documentsRoot.value,
    fileMode: fileMode.value
  })
  msg.value = 'Settings saved'
  setTimeout(() => (msg.value = ''), 2000)
}

async function reloadTemplates() {
  const r = await window.api.bundleTemplates.reloadSeeds()
  msg.value = `Reloaded ${r.imported} template file(s)`
}

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}

async function addCategory() {
  if (!newCat.value.name.trim() || !newCat.value.path_template.trim()) {
    msg.value = 'Name and path template are required'
    return
  }
  const slug = newCat.value.slug.trim() || slugify(newCat.value.name)
  const keywords = newCat.value.keywords
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)
  const metadata_schema = newCatSchema.value
    .map((r) => ({
      key: r.key.trim(),
      label: (r.label.trim() || r.key.trim()) as string
    }))
    .filter((r) => r.key.length > 0)
  await window.api.categories.create({
    name: newCat.value.name.trim(),
    slug,
    path_template: newCat.value.path_template.trim(),
    keywords,
    metadata_schema
  })
  newCat.value = { name: '', slug: '', path_template: '', keywords: '' }
  newCatSchema.value = [{ key: '', label: '' }]
  msg.value = 'Category added'
  await load()
}

async function removeCategory(id: number) {
  const r = await window.api.categories.delete(id)
  if (!r.ok) {
    msg.value = r.error || 'Could not delete'
    return
  }
  await load()
}

function parseKeywords(row: (typeof categories.value)[0]): string {
  if (!row.keywords) return ''
  try {
    return (JSON.parse(row.keywords) as string[]).join(', ')
  } catch {
    return row.keywords
  }
}

function parseSchemaSummary(raw: string | null): string {
  if (!raw) return ''
  try {
    const arr = JSON.parse(raw) as Array<{ key?: string; label?: string }>
    if (!Array.isArray(arr) || !arr.length) return ''
    return arr
      .map((x) => (typeof x.label === 'string' ? x.label : x.key) || '')
      .filter(Boolean)
      .join(', ')
  } catch {
    return ''
  }
}

function addSchemaRow() {
  newCatSchema.value.push({ key: '', label: '' })
}

function removeSchemaRow(i: number) {
  newCatSchema.value.splice(i, 1)
  if (!newCatSchema.value.length) newCatSchema.value.push({ key: '', label: '' })
}
</script>

<template>
  <div class="stack">
    <p v-if="msg" class="muted" style="margin: 0">{{ msg }}</p>

    <section class="card stack">
      <h2 class="section-title">Backup</h2>
      <p class="muted" style="margin: 0">
        Pack the cabinet — every filed document, profile, category, and folder — into a portable folder
        you can copy to another Mac or stash on a backup drive. Bringing one back in flags duplicates so
        nothing is silently overwritten.
      </p>
      <div class="row" style="gap: 0.5rem; flex-wrap: wrap">
        <button type="button" class="primary" :disabled="backupBusy" @click="runExport">
          {{ backupBusy ? 'Working…' : 'Export everything…' }}
        </button>
        <button type="button" :disabled="backupBusy" @click="startImport">
          {{ backupBusy ? 'Working…' : 'Import an export…' }}
        </button>
      </div>
    </section>

    <section class="card stack">
      <h2 class="section-title">Profiles</h2>
      <p class="muted" style="margin: 0">
        Each profile gets its own folder under the documents root. A family profile shares a view of
        every assigned member's paperwork.
      </p>

      <ul v-if="profiles.length" class="profile-list">
        <li v-for="p in profiles" :key="p.id" class="profile-row">
          <div class="profile-head">
            <span class="profile-bullet" :class="{ family: p.kind === 'family' }">
              {{ p.name.charAt(0).toUpperCase() }}
            </span>
            <div class="grow">
              <strong>{{ p.name }}</strong>
              <span class="muted small"> · {{ p.kind === 'family' ? 'Family' : p.kind === 'pet' ? 'Pet' : 'Person' }}</span>
              <div class="muted small">
                Folder: <code>{{ p.name }}</code>
              </div>
            </div>
            <div class="row" style="gap: 0.4rem">
              <button type="button" @click="renameProfile(p)">Rename</button>
              <button type="button" class="danger ghost" @click="removeProfile(p)">Delete</button>
            </div>
          </div>
          <div v-if="p.kind === 'family'" class="family-members">
            <div class="muted small" style="margin-bottom: 0.35rem">Members</div>
            <div class="row" style="gap: 0.4rem; flex-wrap: wrap">
              <label
                v-for="person in personProfiles"
                :key="person.id"
                class="member-toggle"
                :class="{ on: familyMembersDraft[p.id]?.has(person.id) }"
              >
                <input
                  type="checkbox"
                  :checked="familyMembersDraft[p.id]?.has(person.id) || false"
                  @change="toggleFamilyMember(p.id, person.id)"
                />
                <span>{{ person.name }}</span>
                <span v-if="person.kind === 'pet'" class="member-tag">pet</span>
              </label>
              <span v-if="!personProfiles.length" class="muted small">
                Add a person or pet profile first to assign members.
              </span>
            </div>
          </div>
        </li>
      </ul>

      <h3 class="section-title" style="margin-top: 0.5rem">Add profile</h3>
      <div class="row" style="gap: 0.5rem; flex-wrap: wrap; align-items: flex-end">
        <div class="grow">
          <label>Name</label>
          <input v-model="newProfileName" placeholder="Kushal, Family, …" @keydown.enter.prevent="addProfile" />
        </div>
        <div>
          <label>Kind</label>
          <select v-model="newProfileKind">
            <option value="person">Person</option>
            <option value="pet">Pet</option>
            <option value="family">Family</option>
          </select>
        </div>
        <button type="button" class="primary" @click="addProfile">Add</button>
      </div>
    </section>

    <section class="card stack">
      <h2 class="section-title">Storage</h2>
      <div>
        <label>Documents root</label>
        <input v-model="documentsRoot" placeholder="~/Documents" />
        <p class="muted" style="margin: 0.35rem 0 0">
          Filed documents are placed under this folder using each category’s path template.
        </p>
      </div>
      <div>
        <label>When filing from Inbox</label>
        <select v-model="fileMode">
          <option value="copy">Copy (keep original where it was)</option>
          <option value="move">Move (Inbox copy is placed in final folder only)</option>
        </select>
      </div>
      <button type="button" class="primary" @click="saveSettings">Save</button>
    </section>

    <section class="card stack">
      <h2 class="section-title">Bundle templates</h2>
      <p class="muted" style="margin: 0">
        JSON files ship with the app under <code>resources/bundle-templates</code>. Reload after
        adding files.
      </p>
      <button type="button" @click="reloadTemplates">Reload templates</button>
    </section>

    <section class="card stack">
      <h2 class="section-title">Categories</h2>
      <p class="muted" style="margin: 0">
        Path template uses <code>{variables}</code>, e.g. <code>Identification/State/{state}</code>
      </p>
      <ul class="cat-list">
        <li v-for="c in categories" :key="c.id" class="cat-row">
          <div>
            <strong>{{ c.name }}</strong>
            <span class="muted"> · {{ c.slug }}</span>
            <div class="muted small">{{ c.path_template }}</div>
            <div v-if="parseKeywords(c)" class="muted small">Keywords: {{ parseKeywords(c) }}</div>
            <div v-if="parseSchemaSummary(c.metadata_schema)" class="muted small">
              Metadata fields: {{ parseSchemaSummary(c.metadata_schema) }}
            </div>
          </div>
          <button type="button" class="danger ghost" @click="removeCategory(c.id)">Delete</button>
        </li>
      </ul>

      <h3 class="section-title" style="margin-top: 0.5rem">New category</h3>
      <div>
        <label>Name</label>
        <input v-model="newCat.name" placeholder="e.g. Social Security card" />
      </div>
      <div>
        <label>Slug (optional)</label>
        <input v-model="newCat.slug" placeholder="auto from name if empty" />
      </div>
      <div>
        <label>Path template (relative to documents root)</label>
        <input v-model="newCat.path_template" placeholder="Identification/SSN" />
      </div>
      <div>
        <label>Filename keywords (comma-separated, for auto-suggest)</label>
        <input v-model="newCat.keywords" placeholder="ssn, social security" />
      </div>
      <div>
        <div class="row" style="justify-content: space-between; align-items: center">
          <label style="margin: 0">Metadata fields (key + label)</label>
          <button type="button" class="ghost" @click="addSchemaRow">Add field</button>
        </div>
        <p class="muted small" style="margin: 0.25rem 0 0">
          Used when filing and for local extraction hints. Keys should be lowercase with underscores.
        </p>
        <div
          v-for="(row, i) in newCatSchema"
          :key="i"
          class="row"
          style="gap: 0.5rem; align-items: flex-end; margin-top: 0.35rem"
        >
          <div class="grow">
            <label class="muted small">Key</label>
            <input v-model="row.key" placeholder="e.g. account_number" />
          </div>
          <div class="grow">
            <label class="muted small">Label</label>
            <input v-model="row.label" placeholder="Shown in UI" />
          </div>
          <button type="button" class="danger ghost" @click="removeSchemaRow(i)">✕</button>
        </div>
      </div>
      <button type="button" class="primary" @click="addCategory">Add category</button>
    </section>

    <div v-if="showImportModal" class="modal-backdrop" @click.self="closeImportModal">
      <div class="modal card stack" style="width: min(820px, 100%)">
        <div class="row" style="justify-content: space-between; align-items: flex-start">
          <div>
            <h2 class="section-title" style="margin: 0">Review import</h2>
            <p class="muted small" style="margin: 0.25rem 0 0">
              Archive from {{ importPlan ? new Date(importPlan.exported_at).toLocaleString() : '' }}
            </p>
          </div>
          <button type="button" class="ghost" @click="closeImportModal">Close</button>
        </div>

        <template v-if="importPlan && !importResult">
          <div class="import-summary">
            <span class="import-pill new">{{ importPlan.totals.new }} new</span>
            <span class="import-pill warn">{{ importPlan.totals.different_spot }} same content elsewhere</span>
            <span class="import-pill skip">{{ importPlan.totals.same_spot }} already filed</span>
          </div>

          <div class="row" style="justify-content: space-between; flex-wrap: wrap; gap: 0.5rem">
            <div class="row" style="gap: 0.4rem">
              <button
                type="button"
                class="chip"
                :class="{ active: dupFilter === 'all' }"
                @click="dupFilter = 'all'"
              >
                All ({{ importPlan.totals.total }})
              </button>
              <button
                type="button"
                class="chip"
                :class="{ active: dupFilter === 'duplicates' }"
                @click="dupFilter = 'duplicates'"
              >
                Duplicates only ({{ importPlan.totals.same_spot + importPlan.totals.different_spot }})
              </button>
            </div>
            <div class="row" style="gap: 0.4rem">
              <button type="button" @click="applyRecommendedAll">Use recommendations</button>
              <button type="button" @click="setAll('import')">Import shown</button>
              <button type="button" @click="setAll('skip')">Skip shown</button>
            </div>
          </div>

          <ul class="import-list">
            <li v-for="row in visibleRows" :key="row.hash" class="import-row" :class="row.duplicate_kind">
              <div class="import-row-main">
                <div class="grow" style="min-width: 0">
                  <div class="import-row-title">{{ row.filing_name || row.original_name }}</div>
                  <div class="muted small">
                    {{ row.category_name || 'No category' }}
                    <span v-if="row.profile_name"> · <span class="profile-tag">{{ row.profile_name }}</span></span>
                  </div>
                  <div class="muted small" style="margin-top: 0.2rem">{{ row.reason }}</div>
                  <ul v-if="row.existing.length" class="existing-list">
                    <li v-for="ex in row.existing" :key="ex.id" class="muted small">
                      Already on disk: {{ ex.profile_name || 'No profile' }} · {{ ex.category_name || 'No category' }}
                    </li>
                  </ul>
                </div>
                <span class="dup-badge" :class="row.duplicate_kind">{{ dupBadgeText(row.duplicate_kind) }}</span>
              </div>
              <div class="row" style="gap: 0.4rem; margin-top: 0.45rem">
                <button
                  type="button"
                  class="chip"
                  :class="{ active: importDecisions.get(row.hash) === 'import' }"
                  @click="setDecision(row.hash, 'import')"
                >
                  Import
                </button>
                <button
                  type="button"
                  class="chip"
                  :class="{ active: importDecisions.get(row.hash) === 'skip' }"
                  @click="setDecision(row.hash, 'skip')"
                >
                  Skip
                </button>
                <span v-if="importDecisions.get(row.hash) === row.recommended_action" class="muted small">
                  · matches recommendation
                </span>
              </div>
            </li>
          </ul>
          <p v-if="!visibleRows.length" class="muted">Nothing matches that filter.</p>

          <div class="row" style="justify-content: space-between; padding-top: 0.5rem; border-top: 1px solid var(--border)">
            <p class="muted small" style="margin: 0">
              {{ importCounts.imp }} to import · {{ importCounts.skip }} to skip
            </p>
            <div class="row" style="gap: 0.4rem">
              <button type="button" @click="closeImportModal">Cancel</button>
              <button type="button" class="primary" :disabled="backupBusy" @click="applyImport">
                {{ backupBusy ? 'Importing…' : 'Apply' }}
              </button>
            </div>
          </div>
        </template>

        <template v-else-if="importResult">
          <p class="muted">
            Imported {{ importResult.imported }}, skipped {{ importResult.skipped }}.
            <span v-if="importResult.bundlesImported"> · {{ importResult.bundlesImported }} bundle(s) recreated.</span>
          </p>
          <div v-if="importResult.errors.length" class="stack" style="gap: 0.4rem">
            <p class="muted small" style="margin: 0; color: var(--danger)">
              {{ importResult.errors.length }} item(s) could not be imported:
            </p>
            <ul class="muted small" style="margin: 0">
              <li v-for="(err, i) in importResult.errors" :key="i">{{ err.message }}</li>
            </ul>
          </div>
          <div class="row" style="justify-content: flex-end">
            <button type="button" class="primary" @click="closeImportModal">Done</button>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cat-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.cat-row {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: flex-start;
  border-bottom: 1px solid var(--border);
  padding-bottom: 0.75rem;
}
.small {
  font-size: 0.8rem;
}
.grow {
  flex: 1;
  min-width: 0;
}
code {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.82em;
  background: rgba(216, 199, 154, 0.08);
  padding: 0.12rem 0.35rem;
  border-radius: 4px;
  border: 1px solid var(--border);
}

.profile-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
.profile-row {
  border-bottom: 1px solid var(--border);
  padding-bottom: 0.85rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.profile-head {
  display: flex;
  gap: 0.6rem;
  align-items: center;
}
.profile-bullet {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--serif);
  font-weight: 600;
  font-size: 1rem;
  color: #1c1208;
  background: linear-gradient(180deg, var(--brass-bright) 0%, var(--brass) 100%);
  flex-shrink: 0;
}
.profile-bullet.family {
  border: 1px dashed rgba(72, 50, 24, 0.5);
}
.family-members {
  padding: 0.5rem 0 0 2.4rem;
  display: flex;
  flex-direction: column;
}
.member-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.25rem 0.6rem;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: rgba(216, 199, 154, 0.04);
  font-size: 0.85rem;
  cursor: pointer;
  text-transform: none;
  letter-spacing: 0;
  margin: 0;
  color: var(--text);
}
.member-toggle.on {
  background: rgba(196, 154, 92, 0.18);
  border-color: rgba(196, 154, 92, 0.45);
}
.member-toggle input {
  width: auto;
  margin: 0;
}
.member-tag {
  font-size: 0.62rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-dim);
  border: 1px solid var(--border-strong);
  border-radius: 999px;
  padding: 0 0.4rem;
  margin-left: 0.1rem;
}
.member-toggle.on .member-tag {
  color: var(--brass-bright);
  border-color: rgba(196, 154, 92, 0.45);
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
  padding: 1rem;
}
.modal {
  max-height: 90vh;
  overflow: auto;
}
.profile-tag {
  font-family: var(--serif);
  font-style: italic;
  color: var(--brass-bright);
}
.import-summary {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.import-pill {
  font-size: 0.78rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 0.25rem 0.6rem;
  border-radius: 3px;
  border: 1px solid var(--border);
  background: rgba(216, 199, 154, 0.06);
  color: var(--text-dim);
}
.import-pill.new {
  color: var(--ok);
  border-color: rgba(143, 178, 122, 0.4);
  background: rgba(143, 178, 122, 0.08);
}
.import-pill.warn {
  color: var(--warn);
  border-color: rgba(214, 160, 66, 0.4);
  background: rgba(214, 160, 66, 0.08);
}
.import-pill.skip {
  color: var(--text-dim);
}
.import-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}
.import-row {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 0.7rem 0.85rem;
  background: rgba(216, 199, 154, 0.025);
}
.import-row.same_spot {
  border-color: rgba(216, 199, 154, 0.18);
  background: rgba(255, 255, 255, 0.015);
}
.import-row.different_spot {
  border-color: rgba(214, 160, 66, 0.35);
  background: rgba(214, 160, 66, 0.05);
}
.import-row-main {
  display: flex;
  gap: 0.6rem;
  align-items: flex-start;
}
.import-row-title {
  font-family: var(--serif);
  font-size: 0.98rem;
}
.dup-badge {
  font-size: 0.65rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  padding: 0.15rem 0.5rem;
  border-radius: 3px;
  border: 1px solid var(--border);
  color: var(--text-dim);
  white-space: nowrap;
  flex-shrink: 0;
}
.dup-badge.different_spot {
  color: var(--warn);
  border-color: rgba(214, 160, 66, 0.4);
  background: rgba(214, 160, 66, 0.08);
}
.dup-badge.same_spot {
  color: var(--text-dim);
  border-color: var(--border-strong);
}
.dup-badge.none {
  color: var(--ok);
  border-color: rgba(143, 178, 122, 0.4);
  background: rgba(143, 178, 122, 0.08);
}
.existing-list {
  list-style: none;
  padding: 0;
  margin: 0.3rem 0 0;
}
</style>
