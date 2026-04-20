<script setup lang="ts">
import { onMounted, ref } from 'vue'

const documentsRoot = ref('')
const fileMode = ref<'copy' | 'move'>('copy')
const msg = ref('')
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
  background: rgba(255, 255, 255, 0.08);
  padding: 0.12rem 0.35rem;
  border-radius: 4px;
  border: 1px solid var(--border);
}
</style>
