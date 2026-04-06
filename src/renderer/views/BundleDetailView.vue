<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()

type Item = {
  id: number
  category_slug: string
  label: string
  required: number
}

type Attachment = {
  id: number
  template_item_id: number
  document_id: number
  original_name: string
  stored_path: string
  category_slug: string | null
}

type Detail = {
  bundle: Record<string, unknown>
  items: Item[]
  attachments: Attachment[]
}

const detail = ref<Detail | null>(null)
const pickerItem = ref<Item | null>(null)
const docsForPicker = ref<Record<string, unknown>[]>([])
const busy = ref(false)

const id = computed(() => Number(route.params.id))

function attachmentForItem(itemId: number): Attachment | undefined {
  return detail.value?.attachments.find((a) => a.template_item_id === itemId)
}

function satisfied(item: Item): boolean {
  return !!attachmentForItem(item.id)
}

async function load() {
  detail.value = (await window.api.bundles.getDetail(id.value)) as Detail | null
}

onMounted(load)
watch(
  () => route.params.id,
  () => load()
)

async function openPicker(item: Item) {
  pickerItem.value = item
  const all = (await window.api.documents.list({ status: 'complete' })) as Record<
    string,
    unknown
  >[]
  const cats = await window.api.categories.list()
  const slug = item.category_slug
  const cat = (cats as Array<{ id: number; slug: string }>).find((c) => c.slug === slug)
  docsForPicker.value = cat ? all.filter((d) => d.category_id === cat.id) : all
}

async function attach(docId: number) {
  if (!pickerItem.value || !detail.value) return
  busy.value = true
  try {
    await window.api.bundles.attach(id.value, docId, pickerItem.value.id)
    pickerItem.value = null
    await load()
  } finally {
    busy.value = false
  }
}

async function detach(attId: number) {
  busy.value = true
  try {
    await window.api.bundles.detach(attId)
    await load()
  } finally {
    busy.value = false
  }
}

async function removeBundle() {
  if (!confirm('Delete this bundle? Documents stay in your library.')) return
  await window.api.bundles.delete(id.value)
  router.push('/bundles')
}
</script>

<template>
  <div v-if="!detail" class="muted">Not found.</div>
  <div v-else class="stack">
    <RouterLink to="/bundles" class="back-link">← Back to Bundles</RouterLink>
    <div class="row" style="justify-content: space-between; align-items: flex-start">
      <div>
        <h1 class="bundle-title">{{ detail.bundle.name }}</h1>
        <p class="muted" style="margin: 0.25rem 0 0">{{ detail.bundle.template_name }}</p>
      </div>
      <button type="button" class="danger ghost" @click="removeBundle">Delete bundle</button>
    </div>

    <ul class="list">
      <li v-for="item in detail.items" :key="item.id" class="card stack" style="gap: 0.5rem">
        <div class="row" style="justify-content: space-between">
          <div>
            <strong>{{ item.label }}</strong>
            <span class="muted"> · {{ item.category_slug }}</span>
          </div>
          <span v-if="satisfied(item)" class="badge ok">Attached</span>
          <span v-else-if="item.required" class="badge warn">Missing</span>
          <span v-else class="badge">Optional</span>
        </div>
        <div v-if="attachmentForItem(item.id)" class="row" style="justify-content: space-between">
          <RouterLink :to="{ name: 'document', params: { id: String(attachmentForItem(item.id)!.document_id) } }">
            {{ attachmentForItem(item.id)!.original_name }}
          </RouterLink>
          <button
            type="button"
            class="ghost"
            @click="detach(attachmentForItem(item.id)!.id)"
          >
            Remove
          </button>
        </div>
        <button v-else type="button" class="primary" @click="openPicker(item)">Attach document…</button>
      </li>
    </ul>

    <div v-if="pickerItem" class="card stack picker">
      <div class="row" style="justify-content: space-between">
        <strong>Pick document for: {{ pickerItem.label }}</strong>
        <button type="button" class="ghost" @click="pickerItem = null">Close</button>
      </div>
      <p class="muted" style="margin: 0">
        Showing filed documents for category slug
        <strong>{{ pickerItem.category_slug }}</strong>
        (empty list means nothing filed in that category yet).
      </p>
      <ul class="mini">
        <li v-for="d in docsForPicker" :key="String(d.id)">
          <button type="button" class="linkish" :disabled="busy" @click="attach(Number(d.id))">
            {{ d.original_name }}
          </button>
        </li>
      </ul>
      <p v-if="!docsForPicker.length" class="muted">No matching documents. File one from Inbox first.</p>
    </div>
  </div>
</template>

<style scoped>
.bundle-title {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.mini {
  list-style: none;
  padding: 0;
  margin: 0;
}
.linkish {
  background: none;
  border: none;
  color: var(--accent-bright);
  padding: 0.2rem 0;
  cursor: pointer;
  text-align: left;
}
.picker {
  position: sticky;
  bottom: 0;
}
</style>
