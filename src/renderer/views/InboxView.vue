<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
const drafts = ref<Record<string, unknown>[]>([])
const loading = ref(false)
const dragOver = ref(false)
const error = ref('')

async function load() {
  drafts.value = (await window.api.documents.list({ status: 'draft' })) as Record<
    string,
    unknown
  >[]
}

onMounted(load)

async function pickFile() {
  error.value = ''
  const p = await window.api.dialog.openFile()
  if (!p) return
  await ingestPath(p)
}

async function ingestPath(path: string) {
  loading.value = true
  error.value = ''
  try {
    const r = await window.api.documents.createDraft(path)
    await load()
    router.push({ name: 'document', params: { id: String(r.id) } })
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not add file'
  } finally {
    loading.value = false
  }
}

function onDrop(e: DragEvent) {
  dragOver.value = false
  const f = e.dataTransfer?.files?.[0]
  if (!f) return
  const path = (f as File & { path?: string }).path
  if (path) void ingestPath(path)
  else error.value = 'Drag files from Finder (desktop paths are required).'
}

function onDragOver(e: DragEvent) {
  e.preventDefault()
  dragOver.value = true
}

function onDragLeave() {
  dragOver.value = false
}
</script>

<template>
  <div class="stack">
    <p class="lead">
      Drop a PDF or image, or pick one from disk. We will suggest a category from the filename—you can
      always change it, save progress, and come back later.
    </p>

    <div
      class="dropzone"
      :class="{ drag: dragOver }"
      @drop.prevent="onDrop"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
    >
      <p style="margin: 0 0 0.5rem">Drop a file here</p>
      <button type="button" class="primary" :disabled="loading" @click="pickFile">
        {{ loading ? 'Working…' : 'Choose file…' }}
      </button>
    </div>
    <p v-if="error" class="muted" style="color: var(--danger); margin: 0">{{ error }}</p>

    <section v-if="drafts.length" class="stack">
      <h2 class="section-title">Drafts — pick up anytime</h2>
      <ul class="list">
        <li v-for="d in drafts" :key="String(d.id)" class="card row" style="justify-content: space-between">
          <div>
            <strong>{{ d.original_name }}</strong>
            <span class="muted"> · updated {{ d.updated_at }}</span>
          </div>
          <RouterLink class="btn primary" :to="{ name: 'document', params: { id: String(d.id) } }">
            Continue
          </RouterLink>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
</style>
