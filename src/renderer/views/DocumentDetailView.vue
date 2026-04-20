<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { templateVarKeys } from '../lib/path-template'

const route = useRoute()
const router = useRouter()

type Category = {
  id: number
  name: string
  slug: string
  path_template: string
  metadata_schema: string | null
}

const doc = ref<Record<string, unknown> | null>(null)
const categories = ref<Category[]>([])
const categoryId = ref<number | null>(null)
const templateVars = ref<Record<string, string>>({})
const metadata = ref<Record<string, string>>({})
const busy = ref(false)
const msg = ref('')

const showNewType = ref(false)
const newType = ref({ name: '', slug: '', path_template: '', keywords: '' })
const newTypeSchema = ref<Array<{ key: string; label: string }>>([{ key: '', label: '' }])

/** Filename stem when filing (no extension); extension stays from the original upload. */
const filingName = ref('')

/** Inline “add metadata field” (Electron often blocks window.prompt in the renderer). */
const showAddMetadataField = ref(false)
const newMetadataKeyInput = ref('')

const id = computed(() => Number(route.params.id))

const isDraft = computed(() => doc.value?.status === 'draft')

const selectedCategory = computed(() =>
  categories.value.find((c) => c.id === categoryId.value)
)

const varKeys = computed(() => {
  const t = selectedCategory.value?.path_template || ''
  return templateVarKeys(t)
})

const analysisRecord = computed((): Record<string, unknown> | null => {
  const a = doc.value?.analysis
  if (!a) return null
  if (typeof a === 'string') {
    try {
      return JSON.parse(a) as Record<string, unknown>
    } catch {
      return null
    }
  }
  if (typeof a === 'object') return a as Record<string, unknown>
  return null
})

const detectionSummary = computed(() => {
  const a = analysisRecord.value
  if (!a) return null
  const name = typeof a.name === 'string' ? a.name : null
  const conf = typeof a.confidence === 'number' ? a.confidence : 0
  const slug = typeof a.slug === 'string' ? a.slug : null
  const extractSource = typeof a.extractSource === 'string' ? a.extractSource : null
  const extractError = typeof a.extractError === 'string' ? a.extractError : null
  const suggestedCategoryId = typeof a.suggestedCategoryId === 'number' ? a.suggestedCategoryId : null
  const autoApplied = a.autoApplied === true
  return { name, conf, slug, extractSource, extractError, suggestedCategoryId, autoApplied }
})

/** Resolves suggestion id from stored analysis (new `suggestedCategoryId` or legacy `slug`). */
const resolvedSuggestion = computed((): { id: number; label: string } | null => {
  const a = analysisRecord.value
  if (!a) return null
  if (typeof a.suggestedCategoryId === 'number') {
    const label =
      (typeof a.name === 'string' && a.name) ||
      categories.value.find((c) => c.id === a.suggestedCategoryId)?.name ||
      'Suggested type'
    return { id: a.suggestedCategoryId, label }
  }
  const slug = typeof a.slug === 'string' ? a.slug : null
  if (!slug) return null
  const cat = categories.value.find((c) => c.slug === slug)
  if (!cat) return null
  const label =
    (typeof a.name === 'string' && a.name) || cat.name || 'Suggested type'
  return { id: cat.id, label }
})

const suggestionApplied = computed(() => {
  if (!doc.value || !resolvedSuggestion.value) return false
  const cur = doc.value.category_id
  return cur != null && Number(cur) === resolvedSuggestion.value.id
})

const showUseSuggestion = computed(
  () => isDraft.value && resolvedSuggestion.value != null && !suggestionApplied.value
)

const useSuggestionLabel = computed(() => resolvedSuggestion.value?.label ?? 'Suggested type')

const schemaFields = computed(() => {
  if (isDraft.value && selectedCategory.value?.metadata_schema) {
    return parseSchema(selectedCategory.value.metadata_schema)
  }
  const raw = doc.value?.metadata_schema as string | null | undefined
  if (!raw) return [] as Array<{ key: string; label: string }>
  return parseSchema(raw)
})

const schemaFieldKeys = computed(() => new Set(schemaFields.value.map((f) => f.key)))

/** Keys present in metadata but not in the category template (user-added or legacy). */
const extraMetadataKeys = computed(() =>
  Object.keys(metadata.value)
    .filter((k) => !schemaFieldKeys.value.has(k))
    .sort()
)

const ext = computed(() => {
  const n = String(doc.value?.original_name || '')
  const i = n.lastIndexOf('.')
  return i >= 0 ? n.slice(i + 1).toLowerCase() : ''
})

const originalStem = computed(() => stemFromOriginalFilename(String(doc.value?.original_name || '')))

const displayDraftFilename = computed(() => {
  const stem = filingName.value.trim() || originalStem.value || 'document'
  return ext.value ? `${stem}.${ext.value}` : stem
})

const isImage = computed(() =>
  ['png', 'jpg', 'jpeg', 'webp', 'gif', 'heic'].includes(ext.value)
)
const isPdf = computed(() => ext.value === 'pdf')

const previewSrc = computed(() => {
  if (!doc.value?.id) return ''
  return window.api.previewUrl(Number(doc.value.id))
})

function parseJsonObject(s: unknown): Record<string, string> {
  if (!s || typeof s !== 'string') return {}
  try {
    const o = JSON.parse(s) as Record<string, unknown>
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(o)) {
      if (k.startsWith('__')) continue
      out[k] = v == null ? '' : String(v)
    }
    return out
  } catch {
    return {}
  }
}

function parseSchema(raw: unknown): Array<{ key: string; label: string }> {
  if (!raw || typeof raw !== 'string') return []
  try {
    return JSON.parse(raw) as Array<{ key: string; label: string }>
  } catch {
    return []
  }
}

function stemFromOriginalFilename(name: string): string {
  const n = String(name || '')
  const i = n.lastIndexOf('.')
  return i > 0 ? n.slice(0, i) : n
}

function loadFilingStemFromDoc(d: Record<string, unknown>) {
  let stem = ''
  if (d.filing_name != null && String(d.filing_name).trim() !== '') {
    stem = String(d.filing_name).trim()
  } else {
    const raw = d.analysis
    if (raw) {
      try {
        const ar =
          typeof raw === 'string' ? (JSON.parse(raw) as Record<string, unknown>) : (raw as Record<string, unknown>)
        if (typeof ar.suggestedFileStem === 'string' && ar.suggestedFileStem.trim()) {
          stem = ar.suggestedFileStem.trim()
        }
      } catch {
        /* ignore */
      }
    }
    if (!stem) stem = stemFromOriginalFilename(String(d.original_name || ''))
  }
  filingName.value = stem
}

function ensureSchemaKeysInMetadata(fields: Array<{ key: string; label: string }>) {
  for (const f of fields) {
    if (metadata.value[f.key] === undefined) metadata.value[f.key] = ''
  }
}

async function load() {
  msg.value = ''
  showAddMetadataField.value = false
  newMetadataKeyInput.value = ''
  const d = await window.api.documents.get(id.value)
  doc.value = d ?? null
  if (!d) return
  categoryId.value = (d.category_id as number) || null
  metadata.value = parseJsonObject(d.metadata)
  templateVars.value = parseJsonObject(d.template_vars)
  categories.value = (await window.api.categories.list()) as Category[]
  const schemaFromDoc = parseSchema(d.metadata_schema)
  ensureSchemaKeysInMetadata(schemaFromDoc)
  const sel = categories.value.find((c) => c.id === categoryId.value)
  if (sel) ensureSchemaKeysInMetadata(parseSchema(sel.metadata_schema))
  loadFilingStemFromDoc(d)
}

onMounted(load)
watch(
  () => route.params.id,
  () => load()
)

watch(selectedCategory, (c) => {
  if (!c || !isDraft.value) return
  for (const k of templateVarKeys(c.path_template)) {
    if (templateVars.value[k] === undefined) templateVars.value[k] = ''
  }
  ensureSchemaKeysInMetadata(parseSchema(c.metadata_schema))
})

function metadataForExport(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(metadata.value)) {
    if (k.startsWith('__')) continue
    out[k] = v
  }
  return out
}

async function saveMetadata() {
  if (!doc.value) return
  busy.value = true
  try {
    await window.api.documents.updateMetadata(
      Number(doc.value.id),
      metadataForExport(),
      filingName.value.trim()
    )
    msg.value = 'Saved'
    await load()
  } finally {
    busy.value = false
  }
}

async function saveProgress() {
  if (!doc.value || categoryId.value == null) {
    msg.value = 'Pick a category first'
    return
  }
  busy.value = true
  try {
    await window.api.documents.finalize({
      id: Number(doc.value.id),
      categoryId: categoryId.value,
      templateVars: { ...templateVars.value },
      continueLater: true,
      metadata: metadataForExport(),
      filingStem: filingName.value.trim()
    })
    msg.value = 'Draft saved'
    await load()
  } finally {
    busy.value = false
  }
}

async function finalize() {
  if (!doc.value || categoryId.value == null) {
    msg.value = 'Pick a category'
    return
  }
  busy.value = true
  try {
    await window.api.documents.finalize({
      id: Number(doc.value.id),
      categoryId: categoryId.value,
      templateVars: { ...templateVars.value },
      continueLater: false,
      metadata: metadataForExport(),
      filingStem: filingName.value.trim()
    })
    msg.value = 'Filed'
    await load()
  } catch (e) {
    msg.value = e instanceof Error ? e.message : 'Could not file document'
  } finally {
    busy.value = false
  }
}

async function rerunAnalysis(resetCategory: boolean) {
  if (!doc.value) return
  busy.value = true
  msg.value = ''
  try {
    await window.api.documents.analyzeLocal({
      id: Number(doc.value.id),
      resetCategory
    })
    msg.value = resetCategory ? 'Re-detected type from local text/OCR.' : 'Local analysis refreshed.'
    await load()
  } catch (e) {
    msg.value = e instanceof Error ? e.message : 'Analysis failed'
  } finally {
    busy.value = false
  }
}

async function refreshFilingStemFromDetails() {
  if (!doc.value) return
  busy.value = true
  try {
    filingName.value = await window.api.documents.computeFilingStem(Number(doc.value.id))
    msg.value = 'Updated file name from category and metadata.'
  } catch (e) {
    msg.value = e instanceof Error ? e.message : 'Could not suggest a file name'
  } finally {
    busy.value = false
  }
}

async function useSuggestion() {
  if (!doc.value) return
  busy.value = true
  msg.value = ''
  try {
    await window.api.documents.applySuggestion(Number(doc.value.id))
    msg.value =
      'Applied suggested type and extracted fields. Review the category, path variables, and metadata, then file.'
    await load()
  } catch (e) {
    msg.value = e instanceof Error ? e.message : 'Could not apply suggestion'
  } finally {
    busy.value = false
  }
}

async function removeDoc() {
  if (!doc.value || !confirm('Remove this document from the app?')) return
  busy.value = true
  try {
    const wasDraft = doc.value.status === 'draft'
    await window.api.documents.delete(Number(doc.value.id))
    router.push(wasDraft ? '/inbox' : '/library')
  } finally {
    busy.value = false
  }
}

function copyField(key: string) {
  const v = metadata.value[key] || ''
  void navigator.clipboard.writeText(v)
}

function copyJson() {
  void navigator.clipboard.writeText(JSON.stringify(metadataForExport(), null, 2))
}

function normalizeMetadataKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
}

function openAddMetadataField() {
  showAddMetadataField.value = true
  newMetadataKeyInput.value = ''
  msg.value = ''
}

function cancelAddMetadataField() {
  showAddMetadataField.value = false
  newMetadataKeyInput.value = ''
}

function confirmAddMetadataField() {
  const k = normalizeMetadataKey(newMetadataKeyInput.value)
  if (!k) {
    msg.value = 'Enter a field name using letters, numbers, or underscores.'
    return
  }
  if (metadata.value[k] !== undefined) {
    msg.value = `A field named “${k}” already exists.`
    return
  }
  metadata.value = { ...metadata.value, [k]: '' }
  showAddMetadataField.value = false
  newMetadataKeyInput.value = ''
  msg.value = ''
}

function addNewTypeSchemaRow() {
  newTypeSchema.value.push({ key: '', label: '' })
}

function removeNewTypeSchemaRow(i: number) {
  newTypeSchema.value.splice(i, 1)
  if (!newTypeSchema.value.length) newTypeSchema.value.push({ key: '', label: '' })
}

function openNewTypeModal() {
  newType.value = { name: '', slug: '', path_template: 'Misc/{name}', keywords: '' }
  newTypeSchema.value = [
    { key: 'title', label: 'Title' },
    { key: 'date', label: 'Date' }
  ]
  showNewType.value = true
}

async function submitNewType() {
  const name = newType.value.name.trim()
  const path_template = newType.value.path_template.trim()
  if (!name || !path_template) {
    msg.value = 'Name and path template are required'
    return
  }
  const slug =
    newType.value.slug.trim() ||
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
  const keywords = newType.value.keywords
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)
  const metadata_schema = newTypeSchema.value
    .map((r) => ({
      key: r.key.trim(),
      label: (r.label.trim() || r.key.trim()) as string
    }))
    .filter((r) => r.key.length > 0)

  busy.value = true
  try {
    const newId = await window.api.categories.create({
      name,
      slug,
      path_template,
      keywords,
      metadata_schema
    })
    await load()
    categoryId.value = newId
    showNewType.value = false
    msg.value = `Created type “${name}”.`
  } catch (e) {
    msg.value = e instanceof Error ? e.message : 'Could not create type'
  } finally {
    busy.value = false
  }
}

async function reveal() {
  const p = doc.value?.stored_path as string
  if (p) await window.api.shell.reveal(p)
}

async function openDefault() {
  const p = doc.value?.stored_path as string
  if (p) await window.api.shell.open(p)
}
</script>

<template>
  <div v-if="!doc" class="muted">Not found.</div>
  <div v-else class="layout stack">
    <RouterLink :to="isDraft ? '/inbox' : '/library'" class="back-link">
      ← {{ isDraft ? 'Back to Inbox' : 'Back to Library' }}
    </RouterLink>
    <div class="row" style="justify-content: space-between; align-items: flex-start">
      <div>
        <h1 class="doc-title">
          <template v-if="isDraft">{{ displayDraftFilename }}</template>
          <template v-else>{{ doc.original_name }}</template>
        </h1>
        <p v-if="isDraft" class="muted small" style="margin: 0.25rem 0 0">
          Original upload: {{ doc.original_name }}
        </p>
        <p class="muted mono path-line" style="margin: 0.35rem 0 0">{{ doc.stored_path }}</p>
      </div>
      <div class="row">
        <span v-if="isDraft" class="badge warn">Draft</span>
        <span v-else class="badge ok">Filed</span>
      </div>
    </div>
    <p v-if="msg" class="muted" style="margin: 0">{{ msg }}</p>

    <div v-if="isDraft" class="card detect-banner">
      <details class="detect-details">
        <summary>How local detection works</summary>
        <p class="muted small" style="margin: 0.35rem 0 0">
          The app reads text from the PDF (or runs OCR on images / scanned pages), then scores each of
          your categories using filename keywords, phrases in the text (for example “Form 1040”, “degree
          certificate”), and simple pattern lists. Scores are turned into a percentage for display only; they
          are not “AI certainty.” The category dropdown is filled automatically only when the score is at or
          above the app’s internal threshold (about 55%). Otherwise you stay in control: use
          <strong>Use suggestion</strong> to apply the top match and any extracted metadata in one step,
          or pick another category.
        </p>
      </details>
      <template v-if="detectionSummary">
        <p v-if="detectionSummary.name" style="margin: 0.75rem 0 0.35rem">
          <strong>Top local match:</strong>
          {{ detectionSummary.name }}
          <span class="muted"
            >({{ Math.round((detectionSummary.conf || 0) * 100) }}% score ·
            {{ detectionSummary.extractSource || 'text' }})</span
          >
        </p>
        <p v-else style="margin: 0.75rem 0 0.35rem">
          <strong>Local analysis:</strong>
          <span class="muted">No category scored strongly — pick a category or create one.</span>
        </p>
        <p
          v-if="detectionSummary.autoApplied"
          class="muted small"
          style="margin: 0 0 0.35rem"
        >
          This score met the auto-select threshold, so the category below was set automatically. You can
          still change it.
        </p>
        <p
          v-else-if="suggestionApplied"
          class="muted small"
          style="margin: 0 0 0.35rem"
        >
          Suggested type and fields are applied — review and file when ready.
        </p>
        <p v-if="detectionSummary.extractError" class="muted" style="margin: 0; color: var(--danger)">
          Text/OCR note: {{ detectionSummary.extractError }}
        </p>
      </template>
      <p v-else class="muted" style="margin: 0.75rem 0 0.35rem">
        No local analysis stored yet (or the first pass failed). Run text/OCR below — everything stays on
        this device.
      </p>
      <div class="row" style="margin-top: 0.5rem; flex-wrap: wrap; gap: 0.35rem; align-items: center">
        <button
          v-if="showUseSuggestion"
          type="button"
          class="primary"
          :disabled="busy"
          @click="useSuggestion"
        >
          Use suggestion: {{ useSuggestionLabel }}
        </button>
        <button type="button" :disabled="busy" @click="rerunAnalysis(false)">Re-run text / OCR</button>
        <button type="button" :disabled="busy" @click="rerunAnalysis(true)">Re-detect type</button>
        <button type="button" class="ghost" :disabled="busy" @click="openNewTypeModal">
          New document type…
        </button>
      </div>
    </div>

    <div class="grid">
      <section class="card stack preview-card">
        <h2 style="margin: 0; font-size: 1rem">Preview</h2>
        <div class="preview-frame">
          <img v-if="isImage" :src="previewSrc" alt="Preview" class="preview-img" />
          <iframe v-else-if="isPdf" class="preview-pdf" title="PDF" :src="previewSrc" />
          <p v-else class="muted">No inline preview. Open the file to view.</p>
        </div>
        <div class="row">
          <button type="button" class="primary" @click="reveal">Show in Finder</button>
          <button type="button" @click="openDefault">Open with default app</button>
        </div>
      </section>

      <section class="card stack">
        <template v-if="isDraft">
          <h2 style="margin: 0; font-size: 1rem">File this document</h2>
          <div>
            <label>Category</label>
            <select v-model.number="categoryId">
              <option :value="null" disabled>Select…</option>
              <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
          </div>
          <div v-for="key in varKeys" :key="key">
            <label>{{ key }}</label>
            <input v-model="templateVars[key]" :placeholder="key" />
          </div>
          <p class="muted" style="margin: 0">
            Path uses your category template under the documents root (see Settings). Missing pieces
            become a folder named “unknown”.
          </p>

          <div style="margin-top: 0.75rem">
            <div class="row" style="justify-content: space-between; align-items: flex-end; gap: 0.5rem">
              <div class="grow">
                <label>File name when filed</label>
                <input v-model="filingName" :placeholder="originalStem || 'Descriptive name'" />
                <p class="muted small" style="margin: 0.25rem 0 0">
                  Extension stays
                  <span class="mono">.{{ ext || '…' }}</span>
                  from the upload. Suggested from document type and metadata; edit as needed.
                </p>
              </div>
              <button
                type="button"
                :disabled="busy || categoryId == null"
                title="Recompute from selected category and metadata fields"
                @click="refreshFilingStemFromDetails"
              >
                Refresh from details
              </button>
            </div>
          </div>

          <div class="row" style="justify-content: space-between; margin-top: 0.75rem">
            <h2 style="margin: 0; font-size: 1rem">Metadata</h2>
            <button type="button" class="ghost" @click="copyJson">Copy JSON</button>
          </div>
          <p class="muted" style="margin: 0">
            Values are filled locally from text/OCR when possible — edit anything that looks wrong
            before filing.
          </p>
          <div v-for="f in schemaFields" :key="'s-' + f.key" class="field-row">
            <div class="grow">
              <label>{{ f.label }}</label>
              <input v-model="metadata[f.key]" />
            </div>
            <button type="button" class="ghost" @click="copyField(f.key)">Copy</button>
          </div>
          <p v-if="!schemaFields.length && selectedCategory" class="muted" style="margin: 0">
            This type has no field template in Settings — only custom fields below.
          </p>
          <div v-for="key in extraMetadataKeys" :key="'x-' + key" class="field-row">
            <div class="grow">
              <label>{{ key }} <span class="muted small">(custom)</span></label>
              <input v-model="metadata[key]" />
            </div>
            <button type="button" class="ghost" @click="copyField(key)">Copy</button>
          </div>
          <div
            v-if="showAddMetadataField"
            class="add-meta-inline stack"
            style="padding: 0.75rem; border: 1px solid var(--border); border-radius: var(--radius)"
          >
            <label style="margin: 0">New field key</label>
            <input
              v-model="newMetadataKeyInput"
              type="text"
              placeholder="e.g. notes or renewal_date"
              autocomplete="off"
              @keydown.enter.prevent="confirmAddMetadataField"
            />
            <div class="row" style="gap: 0.5rem; flex-wrap: wrap">
              <button type="button" class="primary" @click="confirmAddMetadataField">Add field</button>
              <button type="button" class="ghost" @click="cancelAddMetadataField">Cancel</button>
            </div>
          </div>
          <button
            v-else
            type="button"
            class="ghost"
            style="align-self: flex-start"
            @click="openAddMetadataField"
          >
            Add metadata field…
          </button>
          <p v-if="!selectedCategory" class="muted small" style="margin: 0">
            Pick a category above to show template fields; custom fields work either way.
          </p>
          <button type="button" :disabled="busy" @click="saveMetadata">Save metadata</button>

          <div class="row" style="margin-top: 0.75rem">
            <button type="button" @click="saveProgress" :disabled="busy">Save progress</button>
            <button type="button" class="primary" @click="finalize" :disabled="busy">
              Move to library
            </button>
          </div>
        </template>

        <template v-else>
          <div class="row" style="justify-content: space-between">
            <h2 style="margin: 0; font-size: 1rem">Metadata</h2>
            <button type="button" class="ghost" @click="copyJson">Copy JSON</button>
          </div>
          <p class="muted" style="margin: 0">Copy fields when filling forms.</p>
          <div v-for="f in schemaFields" :key="'sf-' + f.key" class="field-row">
            <div class="grow">
              <label>{{ f.label }}</label>
              <input v-model="metadata[f.key]" />
            </div>
            <button type="button" class="ghost" @click="copyField(f.key)">Copy</button>
          </div>
          <p v-if="!schemaFields.length" class="muted" style="margin: 0">
            No field template for this category — add fields here or define a schema in Settings.
          </p>
          <div v-for="key in extraMetadataKeys" :key="'ef-' + key" class="field-row">
            <div class="grow">
              <label>{{ key }} <span class="muted small">(custom)</span></label>
              <input v-model="metadata[key]" />
            </div>
            <button type="button" class="ghost" @click="copyField(key)">Copy</button>
          </div>
          <div
            v-if="showAddMetadataField"
            class="add-meta-inline stack"
            style="padding: 0.75rem; border: 1px solid var(--border); border-radius: var(--radius)"
          >
            <label style="margin: 0">New field key</label>
            <input
              v-model="newMetadataKeyInput"
              type="text"
              placeholder="e.g. notes or renewal_date"
              autocomplete="off"
              @keydown.enter.prevent="confirmAddMetadataField"
            />
            <div class="row" style="gap: 0.5rem; flex-wrap: wrap">
              <button type="button" class="primary" @click="confirmAddMetadataField">Add field</button>
              <button type="button" class="ghost" @click="cancelAddMetadataField">Cancel</button>
            </div>
          </div>
          <button
            v-else
            type="button"
            class="ghost"
            style="align-self: flex-start"
            @click="openAddMetadataField"
          >
            Add metadata field…
          </button>
          <button type="button" class="primary" :disabled="busy" @click="saveMetadata">Save metadata</button>
        </template>

        <button type="button" class="danger ghost" :disabled="busy" @click="removeDoc">
          Remove from app
        </button>
      </section>
    </div>

    <div v-if="showNewType" class="modal-backdrop" @click.self="showNewType = false">
      <div class="modal card stack">
        <h2 style="margin: 0; font-size: 1.05rem">New document type</h2>
        <p class="muted" style="margin: 0">
          Creates a category with a path template and metadata fields. Everything stays on this Mac.
        </p>
        <div>
          <label>Name</label>
          <input v-model="newType.name" placeholder="e.g. Lease agreement" />
        </div>
        <div>
          <label>Slug (optional)</label>
          <input v-model="newType.slug" placeholder="auto from name" />
        </div>
        <div>
          <label>Path template</label>
          <input v-model="newType.path_template" placeholder="Legal/Leases/{property}" />
        </div>
        <div>
          <label>Filename keywords (comma-separated)</label>
          <input v-model="newType.keywords" placeholder="lease, rent" />
        </div>
        <div>
          <div class="row" style="justify-content: space-between; align-items: center">
            <label style="margin: 0">Metadata fields</label>
            <button type="button" class="ghost" @click="addNewTypeSchemaRow">Add field</button>
          </div>
          <div
            v-for="(row, i) in newTypeSchema"
            :key="i"
            class="row"
            style="gap: 0.5rem; align-items: flex-end; margin-top: 0.35rem"
          >
            <div class="grow">
              <label class="muted small">Key</label>
              <input v-model="row.key" placeholder="e.g. property" />
            </div>
            <div class="grow">
              <label class="muted small">Label</label>
              <input v-model="row.label" placeholder="Shown in UI" />
            </div>
            <button type="button" class="danger ghost" @click="removeNewTypeSchemaRow(i)">✕</button>
          </div>
        </div>
        <div class="row">
          <button type="button" @click="showNewType = false">Cancel</button>
          <button type="button" class="primary" :disabled="busy" @click="submitNewType">Create & select</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.layout {
  max-width: 100%;
}
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  align-items: start;
}
@media (max-width: 900px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
.doc-title {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.path-line {
  word-break: break-all;
  font-size: 0.78rem;
  opacity: 0.85;
}

.detect-banner {
  border: 1px solid var(--border);
}
.detect-details summary {
  cursor: pointer;
  font-weight: 600;
  font-size: 0.9rem;
}
.detect-details summary::-webkit-details-marker {
  display: none;
}

.preview-frame {
  min-height: 320px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
}
.preview-img {
  max-width: 100%;
  max-height: 480px;
  object-fit: contain;
}
.preview-pdf {
  width: 100%;
  min-height: 420px;
  border: none;
}
.field-row {
  display: flex;
  gap: 0.5rem;
  align-items: flex-end;
}
.grow {
  flex: 1;
  min-width: 0;
}
.small {
  font-size: 0.78rem;
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
  width: min(520px, 100%);
  max-height: 90vh;
  overflow: auto;
}
</style>
