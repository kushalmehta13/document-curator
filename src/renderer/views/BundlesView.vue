<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()

type Template = { id: number; name: string; description: string | null }
type Bundle = {
  id: number
  name: string
  created_at: string
  template_name: string
  template_id: number
}

const templates = ref<Template[]>([])
const bundles = ref<Bundle[]>([])
const newName = ref('')
const pickedTemplate = ref<number | null>(null)

async function load() {
  templates.value = (await window.api.bundleTemplates.list()) as Template[]
  bundles.value = (await window.api.bundles.list()) as Bundle[]
}

onMounted(load)

async function createBundle() {
  if (pickedTemplate.value == null || !newName.value.trim()) return
  const id = await window.api.bundles.create(pickedTemplate.value, newName.value.trim())
  newName.value = ''
  pickedTemplate.value = null
  await load()
  router.push({ name: 'bundle', params: { id: String(id) } })
}

async function reloadSeeds() {
  await window.api.bundleTemplates.reloadSeeds()
  await load()
}
</script>

<template>
  <div class="stack">
    <section class="card stack">
      <h2 class="section-title">Start a bundle</h2>
      <div>
        <label>Template</label>
        <select v-model.number="pickedTemplate">
          <option :value="null" disabled>Select…</option>
          <option v-for="t in templates" :key="t.id" :value="t.id">{{ t.name }}</option>
        </select>
      </div>
      <div>
        <label>Name</label>
        <input v-model="newName" placeholder="e.g. 2026 green card renewal" />
      </div>
      <button type="button" class="primary" :disabled="pickedTemplate == null || !newName.trim()" @click="createBundle">
        Create bundle
      </button>
      <button type="button" class="ghost" @click="reloadSeeds">Reload templates from app</button>
    </section>

    <section class="stack">
      <h2 class="section-title">Your bundles</h2>
      <ul class="list">
        <li v-for="b in bundles" :key="b.id" class="card row" style="justify-content: space-between">
          <div>
            <RouterLink :to="{ name: 'bundle', params: { id: String(b.id) } }">
              <strong>{{ b.name }}</strong>
            </RouterLink>
            <div class="muted">{{ b.template_name }} · {{ b.created_at }}</div>
          </div>
        </li>
      </ul>
      <p v-if="!bundles.length" class="muted">No bundles yet.</p>
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
