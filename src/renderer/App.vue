<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()

const showHeader = computed(() => !route.meta.hideChrome)
const pageTitle = computed(() => (route.meta.title as string) || 'Document Curator')
const pageTagline = computed(() => (route.meta.tagline as string) || '')
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="sidebar-brand">
        <div class="logo-glow" aria-hidden="true" />
        <div class="brand-text">
          <span class="brand-name">Curator</span>
          <span class="brand-tag">Local workspace</span>
        </div>
      </div>

      <nav class="side-nav">
        <RouterLink to="/inbox" class="nav-item" active-class="active">
          <svg class="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
            <path d="M4 4h16v14H4zM4 8h16M8 4v4" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span>Inbox</span>
        </RouterLink>
        <RouterLink to="/library" class="nav-item" active-class="active">
          <svg class="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" stroke-linecap="round" />
            <path
              d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <path d="M8 7h8M8 11h6" stroke-linecap="round" />
          </svg>
          <span>Library</span>
        </RouterLink>
        <RouterLink to="/bundles" class="nav-item" active-class="active">
          <svg class="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
            <path
              d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <span>Bundles</span>
        </RouterLink>
        <RouterLink to="/settings" class="nav-item" active-class="active">
          <svg class="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
            <circle cx="12" cy="12" r="3" />
            <path
              d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
              stroke-linecap="round"
            />
          </svg>
          <span>Settings</span>
        </RouterLink>
      </nav>

      <p class="sidebar-hint">
        Your files stay on this Mac. Nothing is sent to the cloud.
      </p>
    </aside>

    <div class="main-column">
      <header v-if="showHeader" class="content-head">
        <h1 class="content-title">{{ pageTitle }}</h1>
        <p v-if="pageTagline" class="content-tagline">{{ pageTagline }}</p>
      </header>
      <main class="main-scroll">
        <RouterView />
      </main>
    </div>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  height: 100%;
  min-height: 0;
  background: radial-gradient(1200px 600px at 85% -10%, rgba(124, 58, 237, 0.14), transparent),
    radial-gradient(900px 500px at 0% 100%, rgba(8, 145, 178, 0.1), transparent), var(--bg0);
}

.sidebar {
  width: var(--sidebar-w);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border);
  background: rgba(10, 10, 14, 0.72);
  backdrop-filter: blur(20px);
  -webkit-app-region: drag;
  /* Space below macOS traffic lights (hiddenInset); keep horizontal inset small—no full-height empty column */
  padding: calc(12px + 28px + 10px) 1rem 1.25rem 14px;
}

.sidebar-brand,
.side-nav,
.sidebar-hint {
  -webkit-app-region: no-drag;
}

.sidebar-brand {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 2rem;
  position: relative;
}

.logo-glow {
  width: 38px;
  height: 38px;
  border-radius: 11px;
  background: linear-gradient(135deg, #8b5cf6 0%, #06b6d4 100%);
  box-shadow:
    0 0 24px rgba(139, 92, 246, 0.45),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  flex-shrink: 0;
}

.brand-text {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}

.brand-name {
  font-weight: 700;
  font-size: 1.15rem;
  letter-spacing: -0.03em;
}

.brand-tag {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--text-dim);
}

.side-nav {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  flex: 1;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.55rem 0.75rem;
  border-radius: var(--radius-sm);
  color: var(--text-dim);
  text-decoration: none;
  font-weight: 500;
  font-size: 0.92rem;
  transition:
    background 0.15s,
    color 0.15s;
}

.nav-item:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.05);
  text-decoration: none;
}

.nav-item.active {
  color: var(--text);
  background: linear-gradient(90deg, rgba(124, 58, 237, 0.22) 0%, rgba(8, 145, 178, 0.08) 100%);
  box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.2);
}

.nav-ico {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  opacity: 0.85;
}

.sidebar-hint {
  margin: 1.5rem 0 0;
  padding: 0.65rem 0.55rem;
  font-size: 0.76rem;
  line-height: 1.4;
  color: var(--text-dim);
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border);
  text-wrap: pretty;
  word-break: normal;
  overflow-wrap: break-word;
  hyphens: manual;
}

.main-column {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.content-head {
  flex-shrink: 0;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  padding: 1.75rem 2rem 0.5rem;
  -webkit-app-region: drag;
}

.content-title {
  margin: 0;
  font-size: 1.65rem;
  font-weight: 700;
  letter-spacing: -0.03em;
}

.content-tagline {
  margin: 0.4rem 0 0;
  font-size: 0.95rem;
  color: var(--text-dim);
  max-width: 100%;
  width: 100%;
  line-height: 1.55;
  text-wrap: pretty;
  -webkit-app-region: no-drag;
}

.main-scroll {
  flex: 1;
  min-height: 0;
  min-width: 0;
  width: 100%;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 1rem 2rem 2rem;
  -webkit-app-region: no-drag;
  -webkit-overflow-scrolling: touch;
}
</style>
