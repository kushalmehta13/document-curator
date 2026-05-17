<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'

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
  profile_name?: string | null
  profile_kind?: string | null
}

const categories = ref<Category[]>([])
const documents = ref<DocRow[]>([])
const filterId = ref<number | null>(null)

const filtered = computed(() => {
  if (filterId.value == null) return documents.value
  return documents.value.filter((d) => d.category_id === filterId.value)
})

/** Only categories that actually have a doc in the current profile view, sorted by count desc. */
const drawerTabs = computed(() => {
  const counts = new Map<number, number>()
  for (const d of documents.value) {
    if (d.category_id == null) continue
    counts.set(d.category_id, (counts.get(d.category_id) || 0) + 1)
  }
  const tabs = categories.value
    .filter((c) => counts.has(c.id))
    .map((c) => ({ ...c, count: counts.get(c.id) || 0 }))
  tabs.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  return tabs
})

const totalCount = computed(() => documents.value.length)

async function load() {
  categories.value = (await window.api.categories.list()) as Category[]
  documents.value = (await window.api.documents.list({
    status: 'complete',
    useActiveProfile: true
  })) as DocRow[]
}

const onProfileChanged = () => { void load() }

onMounted(() => {
  void load()
  window.addEventListener('cabinet:profile-changed', onProfileChanged)
})
onBeforeUnmount(() => window.removeEventListener('cabinet:profile-changed', onProfileChanged))
</script>

<template>
  <div class="stack">
    <div v-if="totalCount" class="drawer-tabs" role="tablist" aria-label="Drawers">
      <button
        type="button"
        class="drawer-tab"
        :class="{ active: filterId === null }"
        role="tab"
        :aria-selected="filterId === null"
        @click="filterId = null"
      >
        <span class="drawer-tab-name">All drawers</span>
        <span class="drawer-tab-count">{{ totalCount }}</span>
      </button>
      <button
        v-for="c in drawerTabs"
        :key="c.id"
        type="button"
        class="drawer-tab"
        :class="{ active: filterId === c.id }"
        role="tab"
        :aria-selected="filterId === c.id"
        :title="c.name"
        @click="filterId = c.id"
      >
        <span class="drawer-tab-name">{{ c.name }}</span>
        <span class="drawer-tab-count">{{ c.count }}</span>
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
            <span v-if="d.profile_name"> · <span class="profile-tag">{{ d.profile_name }}</span></span>
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
.profile-tag {
  font-family: var(--serif);
  font-style: italic;
  color: var(--brass-bright);
}

/* Filing-cabinet-style tab strip. Tabs sit on a hairline rail; the active one rises out of it. */
.drawer-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  align-items: flex-end;
  padding: 0 0.1rem;
  border-bottom: 1px solid var(--border);
  margin: 0 0 0.25rem;
}

.drawer-tab {
  font: inherit;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.85rem;
  margin-bottom: -1px; /* sit on the rail */
  border: 1px solid var(--border);
  border-bottom: 1px solid transparent;
  border-radius: 6px 6px 0 0;
  background: transparent;
  color: var(--text-dim);
  font-size: 0.85rem;
  cursor: pointer;
  white-space: nowrap;
  max-width: 280px;
  transition: color 0.12s, background 0.12s, border-color 0.12s;
}

.drawer-tab:hover {
  color: var(--text);
  background: rgba(216, 199, 154, 0.05);
  border-color: var(--border-strong);
  border-bottom-color: transparent;
}

.drawer-tab.active {
  color: var(--text);
  background:
    linear-gradient(180deg, rgba(216, 199, 154, 0.08) 0%, rgba(216, 199, 154, 0.03) 100%),
    var(--bg1);
  border-color: var(--border-strong);
  border-bottom-color: var(--bg1);
  box-shadow: inset 0 2px 0 rgba(196, 154, 92, 0.55);
}

.drawer-tab-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.drawer-tab-count {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.7rem;
  color: var(--text-dim);
  background: rgba(216, 199, 154, 0.08);
  border: 1px solid var(--border);
  padding: 0.05rem 0.4rem;
  border-radius: 999px;
  flex-shrink: 0;
}

.drawer-tab.active .drawer-tab-count {
  color: var(--brass-bright);
  background: rgba(196, 154, 92, 0.12);
  border-color: rgba(196, 154, 92, 0.35);
}
</style>
