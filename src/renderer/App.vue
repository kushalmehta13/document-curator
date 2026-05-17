<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, provide } from 'vue'
import { useRoute, useRouter } from 'vue-router'

type Profile = {
  id: number
  name: string
  slug: string
  kind: 'person' | 'family' | 'pet'
  color: string | null
  sort_order: number
  created_at: string
  members: number[]
}

const route = useRoute()
const router = useRouter()

const showHeader = computed(() => !route.meta.hideChrome)
const pageTitle = computed(() => (route.meta.title as string) || 'Document Cabinet')
const pageTagline = computed(() => (route.meta.tagline as string) || '')

const profiles = ref<Profile[]>([])
const activeProfileId = ref<number | null>(null)
const profileMenuOpen = ref(false)
const switcherEl = ref<HTMLElement | null>(null)

async function loadProfiles() {
  profiles.value = (await window.api.profiles.list()) as Profile[]
  const s = await window.api.settings.get()
  activeProfileId.value = s.activeProfileId
}

async function switchProfile(id: number | null) {
  await window.api.settings.set({ activeProfileId: id })
  activeProfileId.value = id
  // tell views to refresh; broadcast via custom event
  window.dispatchEvent(new CustomEvent('cabinet:profile-changed', { detail: id }))
}

async function pickProfile(id: number | null) {
  profileMenuOpen.value = false
  await switchProfile(id)
}

function goManageProfiles() {
  profileMenuOpen.value = false
  router.push('/settings')
}

function onDocClick(e: MouseEvent) {
  if (!profileMenuOpen.value) return
  const el = switcherEl.value
  if (el && e.target instanceof Node && !el.contains(e.target)) {
    profileMenuOpen.value = false
  }
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && profileMenuOpen.value) profileMenuOpen.value = false
}

provide('cabinet-profiles', { profiles, reload: loadProfiles, activeProfileId, switchProfile })

const onProfileChanged = () => { void loadProfiles() }

onMounted(() => {
  void loadProfiles()
  window.addEventListener('cabinet:profile-changed', onProfileChanged)
  document.addEventListener('mousedown', onDocClick)
  document.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  window.removeEventListener('cabinet:profile-changed', onProfileChanged)
  document.removeEventListener('mousedown', onDocClick)
  document.removeEventListener('keydown', onKey)
})

const activeProfile = computed(() =>
  activeProfileId.value != null ? profiles.value.find((p) => p.id === activeProfileId.value) || null : null
)

function profileInitial(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '·'
  return trimmed[0]!.toUpperCase()
}
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="sidebar-brand">
        <div class="logo-mark" aria-hidden="true">
          <svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3.5" y="4" width="21" height="20" rx="2.5" />
            <path d="M3.5 11h21M3.5 17.5h21" stroke-linecap="round" />
            <circle cx="14" cy="7.5" r="0.9" fill="currentColor" stroke="none" />
            <circle cx="14" cy="14.25" r="0.9" fill="currentColor" stroke="none" />
            <circle cx="14" cy="20.75" r="0.9" fill="currentColor" stroke="none" />
          </svg>
        </div>
        <div class="brand-text">
          <span class="brand-name">Document Cabinet</span>
          <span class="brand-tag">Files in their place</span>
        </div>
      </div>

      <div class="profile-switcher" ref="switcherEl">
        <span class="profile-label">Filing for</span>
        <button
          type="button"
          class="profile-trigger"
          :class="{ open: profileMenuOpen }"
          :aria-expanded="profileMenuOpen"
          aria-haspopup="listbox"
          @click="profileMenuOpen = !profileMenuOpen"
        >
          <span
            class="profile-initial"
            :class="{
              none: !activeProfile,
              family: activeProfile?.kind === 'family',
              pet: activeProfile?.kind === 'pet'
            }"
          >
            {{ activeProfile?.kind === 'pet' ? '🐾' : activeProfile ? profileInitial(activeProfile.name) : '·' }}
          </span>
          <span class="profile-trigger-text">
            <span class="profile-trigger-name">{{ activeProfile?.name || 'All profiles' }}</span>
            <span class="profile-trigger-kind">{{
              activeProfile?.kind === 'family'
                ? 'Family'
                : activeProfile?.kind === 'pet'
                  ? 'Pet'
                  : activeProfile
                    ? 'Person'
                    : 'Shared cabinet'
            }}</span>
          </span>
          <svg class="profile-caret" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
        <transition name="menu-fade">
          <ul v-if="profileMenuOpen" class="profile-menu" role="listbox">
            <li
              role="option"
              :aria-selected="activeProfileId == null"
              class="profile-menu-item"
              :class="{ active: activeProfileId == null }"
              @click="pickProfile(null)"
            >
              <span class="profile-initial none small">·</span>
              <span class="profile-menu-text">
                <span class="profile-menu-name">All profiles</span>
                <span class="profile-menu-kind">Shared cabinet</span>
              </span>
              <span v-if="activeProfileId == null" class="profile-menu-check">✓</span>
            </li>
            <li
              v-for="p in profiles"
              :key="p.id"
              role="option"
              :aria-selected="activeProfileId === p.id"
              class="profile-menu-item"
              :class="{ active: activeProfileId === p.id }"
              @click="pickProfile(p.id)"
            >
              <span
                class="profile-initial small"
                :class="{ family: p.kind === 'family', pet: p.kind === 'pet' }"
              >
                {{ p.kind === 'pet' ? '🐾' : profileInitial(p.name) }}
              </span>
              <span class="profile-menu-text">
                <span class="profile-menu-name">{{ p.name }}</span>
                <span class="profile-menu-kind">{{
                  p.kind === 'family' ? 'Family' : p.kind === 'pet' ? 'Pet' : 'Person'
                }}</span>
              </span>
              <span v-if="activeProfileId === p.id" class="profile-menu-check">✓</span>
            </li>
            <li class="profile-menu-divider" role="separator" />
            <li class="profile-menu-item manage" @click="goManageProfiles">
              <span class="profile-menu-text">
                <span class="profile-menu-name">Manage profiles…</span>
              </span>
            </li>
          </ul>
        </transition>
      </div>

      <nav class="side-nav">
        <RouterLink to="/inbox" class="nav-item" active-class="active">
          <svg class="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
            <path d="M3.5 13h5l1.5 2h4l1.5-2h5" stroke-linecap="round" stroke-linejoin="round" />
            <path d="M5 5h14v14H5z" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span>Intake tray</span>
        </RouterLink>
        <RouterLink to="/library" class="nav-item" active-class="active">
          <svg class="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
            <rect x="3.5" y="4" width="17" height="16" rx="1.5" />
            <path d="M3.5 9.5h17M3.5 14.5h17" stroke-linecap="round" />
            <path d="M10 7h4M10 12h4M10 17h4" stroke-linecap="round" />
          </svg>
          <span>Cabinet</span>
        </RouterLink>
        <RouterLink to="/bundles" class="nav-item" active-class="active">
          <svg class="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
            <path d="M4 6h7l1.5 2H20v11H4z" stroke-linecap="round" stroke-linejoin="round" />
            <path d="M8 13h8M8 16h5" stroke-linecap="round" />
          </svg>
          <span>Folders</span>
        </RouterLink>
        <RouterLink to="/settings" class="nav-item" active-class="active">
          <svg class="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
            <path d="M5 8h14M5 12h14M5 16h14" stroke-linecap="round" />
            <circle cx="9" cy="8" r="1.4" fill="var(--bg0)" />
            <circle cx="15" cy="12" r="1.4" fill="var(--bg0)" />
            <circle cx="11" cy="16" r="1.4" fill="var(--bg0)" />
          </svg>
          <span>Workshop</span>
        </RouterLink>
      </nav>

      <p class="sidebar-hint">
        Everything stays in this cabinet — nothing leaves your Mac.
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
  background:
    radial-gradient(900px 600px at 100% 0%, rgba(196, 154, 92, 0.06), transparent 70%),
    radial-gradient(800px 500px at 0% 100%, rgba(120, 75, 45, 0.05), transparent 70%),
    var(--bg0);
}

.sidebar {
  width: var(--sidebar-w);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border);
  background:
    linear-gradient(180deg, rgba(40, 28, 18, 0.55) 0%, rgba(22, 16, 10, 0.65) 100%),
    repeating-linear-gradient(
      180deg,
      rgba(255, 255, 255, 0.012) 0,
      rgba(255, 255, 255, 0.012) 1px,
      transparent 1px,
      transparent 4px
    );
  backdrop-filter: blur(20px);
  -webkit-app-region: drag;
  /* Space below macOS traffic lights (hiddenInset); keep horizontal inset small—no full-height empty column */
  padding: calc(12px + 28px + 10px) 1rem 1.25rem 14px;
}

.sidebar-brand,
.side-nav,
.sidebar-hint,
.profile-switcher {
  -webkit-app-region: no-drag;
}

.profile-switcher {
  margin: -0.5rem 0 1.25rem;
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.profile-label {
  font-size: 0.62rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-dim);
  margin: 0 0 0 0.15rem;
}

.profile-trigger {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  width: 100%;
  padding: 0.55rem 0.7rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background:
    linear-gradient(180deg, rgba(255, 247, 232, 0.05) 0%, rgba(255, 247, 232, 0.02) 100%),
    rgba(28, 22, 17, 0.6);
  color: var(--text);
  text-align: left;
  cursor: pointer;
  font: inherit;
  transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
}

.profile-trigger:hover {
  border-color: var(--border-strong);
  background:
    linear-gradient(180deg, rgba(255, 247, 232, 0.07) 0%, rgba(255, 247, 232, 0.03) 100%),
    rgba(28, 22, 17, 0.6);
}

.profile-trigger.open {
  border-color: rgba(196, 154, 92, 0.5);
  box-shadow: 0 0 0 3px rgba(196, 154, 92, 0.12);
}

.profile-initial {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--serif);
  font-weight: 600;
  font-size: 0.95rem;
  color: #1c1208;
  background: linear-gradient(180deg, var(--brass-bright) 0%, var(--brass) 100%);
  box-shadow: inset 0 1px 0 rgba(255, 240, 200, 0.45);
  flex-shrink: 0;
}

.profile-initial.small {
  width: 24px;
  height: 24px;
  font-size: 0.82rem;
}

.profile-initial.family {
  border: 1px dashed rgba(72, 50, 24, 0.55);
}

.profile-initial.pet {
  border: 1px dotted rgba(72, 50, 24, 0.55);
  background: linear-gradient(180deg, #d8c79a 0%, #b9a778 100%);
}

.profile-initial.none {
  color: var(--text-dim);
  background: rgba(216, 199, 154, 0.08);
  box-shadow: none;
  border: 1px dashed var(--border-strong);
}

.profile-trigger-text {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.profile-trigger-name {
  font-family: var(--serif);
  font-size: 0.98rem;
  line-height: 1.1;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-trigger-kind {
  font-size: 0.62rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-dim);
  margin-top: 0.18rem;
}

.profile-caret {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
  color: var(--text-dim);
  transition: transform 0.18s ease, color 0.15s;
}

.profile-trigger.open .profile-caret {
  transform: rotate(180deg);
  color: var(--brass-bright);
}

.profile-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 40;
  list-style: none;
  margin: 0;
  padding: 0.35rem;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background:
    linear-gradient(180deg, rgba(48, 32, 22, 0.96) 0%, rgba(28, 22, 17, 0.98) 100%);
  backdrop-filter: blur(12px);
  box-shadow:
    0 1px 0 rgba(255, 240, 200, 0.04) inset,
    0 8px 28px rgba(0, 0, 0, 0.55),
    0 2px 6px rgba(0, 0, 0, 0.35);
  max-height: 320px;
  overflow-y: auto;
}

.profile-menu-item {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.5rem 0.55rem;
  border-radius: 5px;
  cursor: pointer;
  color: var(--text);
  user-select: none;
  transition: background 0.12s, color 0.12s;
}

.profile-menu-item:hover {
  background: rgba(196, 154, 92, 0.12);
}

.profile-menu-item.active {
  background: rgba(196, 154, 92, 0.18);
}

.profile-menu-text {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.profile-menu-name {
  font-family: var(--serif);
  font-size: 0.95rem;
  line-height: 1.15;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-menu-kind {
  font-size: 0.62rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-dim);
  margin-top: 0.15rem;
}

.profile-menu-check {
  color: var(--brass-bright);
  font-size: 0.95rem;
  flex-shrink: 0;
}

.profile-menu-divider {
  height: 1px;
  margin: 0.3rem 0.25rem;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(196, 154, 92, 0.25) 50%,
    transparent 100%
  );
  list-style: none;
}

.profile-menu-item.manage .profile-menu-name {
  font-family: var(--serif);
  font-style: italic;
  color: var(--text-dim);
}

.profile-menu-item.manage:hover .profile-menu-name {
  color: var(--brass-bright);
}

.menu-fade-enter-active,
.menu-fade-leave-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
  transform-origin: top center;
}

.menu-fade-enter-from,
.menu-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.98);
}

.sidebar-brand {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 2rem;
  position: relative;
}

.logo-mark {
  width: 38px;
  height: 38px;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--brass-bright);
  background: linear-gradient(160deg, rgba(196, 154, 92, 0.18) 0%, rgba(120, 75, 45, 0.12) 100%);
  border: 1px solid rgba(196, 154, 92, 0.35);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.06),
    0 1px 2px rgba(0, 0, 0, 0.35);
  flex-shrink: 0;
}

.logo-mark svg {
  width: 22px;
  height: 22px;
}

.brand-text {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}

.brand-name {
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 600;
  font-size: 1.08rem;
  letter-spacing: -0.01em;
  line-height: 1.15;
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
  background: linear-gradient(90deg, rgba(196, 154, 92, 0.18) 0%, rgba(196, 154, 92, 0.04) 100%);
  box-shadow: inset 0 0 0 1px rgba(196, 154, 92, 0.28);
}

.nav-item.active .nav-ico {
  color: var(--brass-bright);
  opacity: 1;
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
  font-family: 'Fraunces', Georgia, serif;
  font-size: 1.7rem;
  font-weight: 600;
  letter-spacing: -0.02em;
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
