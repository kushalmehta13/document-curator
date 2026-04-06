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

const id = computed(() => Number(route.params.id))

const isDraft = computed(() => doc.value?.status === 'draft')

const selectedCategory = computed(() =>
  categories.value.find((c) => c.id === categoryId.value)
)

const varKeys = computed(() => {
  const t = selectedCategory.value?.path_template || ''
  return templateVarKeys(t)
})

const schemaFields = computed(() => {
  const raw = doc.value?.metadata_schema as string | null | undefined
  if (!raw) return [] as Array<{ key: string; label: string }>
  try {
    return JSON.parse(raw) as Array<{ key: string; label: string }>
  } catch {
    return []
  }
})

const ext = computed(() => {
  const n = String(doc.value?.original_name || '')
  const i = n.lastIndexOf('.')
  return i >= 0 ? n.slice(i + 1).toLowerCase() : ''
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

async function load() {
  msg.value = ''
  const d = await window.api.documents.get(id.value)
  doc.value = d ?? null
  if (!d) return
  categoryId.value = (d.category_id as number) || null
  metadata.value = parseJsonObject(d.metadata)
  templateVars.value = parseJsonObject(d.template_vars)
  for (const f of parseSchema(d.metadata_schema)) {
    if (metadata.value[f.key] === undefined) metadata.value[f.key] = ''
  }
  categories.value = (await window.api.categories.list()) as Category[]
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
})

async function saveMetadata() {
  if (!doc.value) return
  busy.value = true
  try {
    await window.api.documents.updateMetadata(Number(doc.value.id), metadata.value)
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
      continueLater: true
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
      continueLater: false
    })
    msg.value = 'Filed'
    await load()
  } catch (e) {
    msg.value = e instanceof Error ? e.message : 'Could not file document'
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
  void navigator.clipboard.writeText(JSON.stringify(metadata.value, null, 2))
}

function addCustomField() {
  const key = window.prompt('Field name (e.g. dl_number)')
  if (!key || !key.trim()) return
  const k = key.trim()
  if (metadata.value[k] !== undefined) return
  metadata.value[k] = ''
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
        <h1 class="doc-title">{{ doc.original_name }}</h1>
        <p class="muted mono path-line" style="margin: 0.35rem 0 0">{{ doc.stored_path }}</p>
      </div>
      <div class="row">
        <span v-if="isDraft" class="badge warn">Draft</span>
        <span v-else class="badge ok">Filed</span>
      </div>
    </div>
    <p v-if="msg" class="muted" style="margin: 0">{{ msg }}</p>

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
          <div class="row">
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
          <div v-for="f in schemaFields" :key="f.key" class="field-row">
            <div class="grow">
              <label>{{ f.label }}</label>
              <input v-model="metadata[f.key]" />
            </div>
            <button type="button" class="ghost" @click="copyField(f.key)">Copy</button>
          </div>
          <template v-if="!schemaFields.length">
            <p class="muted" style="margin: 0">
              No field template for this category. Add keys below or define a schema in Settings.
            </p>
            <div v-for="key in Object.keys(metadata)" :key="key" class="field-row">
              <div class="grow">
                <label>{{ key }}</label>
                <input v-model="metadata[key]" />
              </div>
              <button type="button" class="ghost" @click="copyField(key)">Copy</button>
            </div>
            <button type="button" class="ghost" @click="addCustomField">Add field…</button>
          </template>
          <button type="button" class="primary" :disabled="busy" @click="saveMetadata">Save metadata</button>
        </template>

        <button type="button" class="danger ghost" :disabled="busy" @click="removeDoc">
          Remove from app
        </button>
      </section>
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
</style>
