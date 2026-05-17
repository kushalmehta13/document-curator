<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
const drafts = ref<Record<string, unknown>[]>([])
const loading = ref(false)
const dragOver = ref(false)
const error = ref('')
const progress = ref('')
const deletingId = ref<number | null>(null)

async function deleteDraft(id: number, name: string) {
  if (!confirm(`Delete draft “${name}”? This removes the inbox file from disk.`)) return
  deletingId.value = id
  error.value = ''
  try {
    await window.api.documents.delete(id)
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not delete draft'
  } finally {
    deletingId.value = null
  }
}

async function load() {
  drafts.value = (await window.api.documents.list({
    status: 'draft',
    useActiveProfile: true
  })) as Record<string, unknown>[]
}

const onProfileChanged = () => { void load() }

onMounted(() => {
  void load()
  window.addEventListener('cabinet:profile-changed', onProfileChanged)
})
onBeforeUnmount(() => window.removeEventListener('cabinet:profile-changed', onProfileChanged))

async function pickFile() {
  error.value = ''
  const paths = await window.api.dialog.openFile()
  if (!paths.length) return
  await ingestPaths(paths)
}

async function ingestPaths(paths: string[]) {
  loading.value = true
  error.value = ''
  progress.value = ''
  const errors: string[] = []
  const createdIds: number[] = []
  try {
    for (let i = 0; i < paths.length; i++) {
      progress.value = paths.length > 1 ? `Adding ${i + 1} of ${paths.length}…` : 'Working…'
      try {
        const r = await window.api.documents.createDraft(paths[i])
        createdIds.push(r.id)
        if (r.analysisError) {
          errors.push(`${paths[i].split('/').pop()}: ${r.analysisError}`)
        }
      } catch (e) {
        errors.push(`${paths[i].split('/').pop()}: ${e instanceof Error ? e.message : 'failed'}`)
      }
    }
    await load()
    if (errors.length) {
      error.value = errors.join('\n')
    }
    if (createdIds.length === 1 && errors.length === 0) {
      router.push({ name: 'document', params: { id: String(createdIds[0]) } })
    }
  } finally {
    loading.value = false
    progress.value = ''
  }
}

function onDrop(e: DragEvent) {
  dragOver.value = false
  const files = e.dataTransfer?.files
  if (!files || !files.length) return
  const paths: string[] = []
  const failed: string[] = []
  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    try {
      const path = window.api.getPathForFile(f)
      if (path) paths.push(path)
      else failed.push(f.name || '(unknown)')
    } catch {
      failed.push(f.name || '(unknown)')
    }
  }
  if (failed.length && !paths.length) {
    error.value =
      'No file paths could be resolved from that drop. Drop files from Finder, or use “Choose files…”.'
    return
  }
  if (failed.length) {
    error.value = `Skipped ${failed.length} item(s) without a file path: ${failed.join(', ')}`
  }
  if (paths.length) void ingestPaths(paths)
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
      Drop paperwork on the tray — PDFs or photos, one or many. The cabinet quietly reads each page on
      this Mac, guesses what it is, and pencils in the labels. Correct what's wrong, set it aside, and
      come back when you're ready to file. Nothing leaves your desk.
    </p>

    <div
      class="dropzone"
      :class="{ drag: dragOver }"
      @drop.prevent="onDrop"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
    >
      <p style="margin: 0 0 0.5rem">Drop paperwork onto the tray</p>
      <button type="button" class="primary" :disabled="loading" @click="pickFile">
        {{ loading ? progress || 'Sorting…' : 'Choose files…' }}
      </button>
    </div>
    <p v-if="error" class="muted" style="color: var(--danger); margin: 0; white-space: pre-wrap">{{ error }}</p>

    <section v-if="drafts.length" class="stack">
      <h2 class="section-title">On the tray</h2>
      <ul class="list">
        <li v-for="d in drafts" :key="String(d.id)" class="card row" style="justify-content: space-between">
          <div>
            <strong>{{ d.original_name }}</strong>
            <span class="muted"> · updated {{ d.updated_at }}</span>
          </div>
          <div class="row" style="gap: 0.5rem">
            <RouterLink class="btn primary" :to="{ name: 'document', params: { id: String(d.id) } }">
              Continue
            </RouterLink>
            <button
              type="button"
              class="btn"
              :disabled="deletingId === Number(d.id)"
              @click="deleteDraft(Number(d.id), String(d.original_name))"
            >
              {{ deletingId === Number(d.id) ? 'Deleting…' : 'Delete' }}
            </button>
          </div>
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
