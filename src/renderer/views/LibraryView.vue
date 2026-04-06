<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

type Category = {
  id: number
  name: string
  slug: string
  path_template: string
}

type DocRow = Record<string, unknown> & {
  id: number
  original_name: string
  status: string
  category_id: number | null
  category_name?: string
}

const categories = ref<Category[]>([])
const documents = ref<DocRow[]>([])
const filterId = ref<number | null>(null)

const filtered = computed(() => {
  if (filterId.value == null) return documents.value
  return documents.value.filter((d) => d.category_id === filterId.value)
})

async function load() {
  categories.value = (await window.api.categories.list()) as Category[]
  documents.value = (await window.api.documents.list({ status: 'complete' })) as DocRow[]
}

onMounted(load)
</script>

<template>
  <div class="stack">
    <div class="row" style="gap: 0.45rem; flex-wrap: wrap">
      <button type="button" class="chip" :class="{ active: filterId === null }" @click="filterId = null">
        All
      </button>
      <button
        v-for="c in categories"
        :key="c.id"
        type="button"
        class="chip"
        :class="{ active: filterId === c.id }"
        @click="filterId = c.id"
      >
        {{ c.name }}
      </button>
    </div>

    <ul class="list">
      <li v-for="d in filtered" :key="d.id" class="card row" style="justify-content: space-between">
        <div>
          <RouterLink :to="{ name: 'document', params: { id: String(d.id) } }">
            {{ d.original_name }}
          </RouterLink>
          <div class="muted" style="margin-top: 0.2rem">
            {{ d.category_name || 'Uncategorized' }}
          </div>
        </div>
        <span class="badge ok">Filed</span>
      </li>
    </ul>
    <p v-if="!filtered.length" class="muted">No documents in this view.</p>
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
