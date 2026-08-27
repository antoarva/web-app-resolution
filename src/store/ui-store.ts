/**
 * UI state: which view is open, theme, and viewport display options.
 * Preferences are mirrored into IndexedDB so a reload restores the session.
 */

import { create } from 'zustand';
import {
  loadPreferences, savePreferences, DEFAULT_PREFERENCES, type StoredPreferences,
} from '@/lib/persistence';

export type ViewId =
  | 'dashboard' | 'geometry' | 'editor' | 'explorer' | 'constructions'
  | 'schedules' | 'hvac' | 'simulation' | 'results' | 'weather' | 'docs';

export type ThemeSetting = 'light' | 'dark' | 'system';

interface UiState {
  view: ViewId;
  theme: ThemeSetting;
  /** Theme actually applied, after resolving `system`. */
  resolvedTheme: 'light' | 'dark';
  editorFontSize: number;
  showGrid: boolean;
  showEdges: boolean;
  autoRun: boolean;
  sidebarCollapsed: boolean;
  inspectorOpen: boolean;
  commandPaletteOpen: boolean;
  hydrated: boolean;

  setView(view: ViewId): void;
  setTheme(theme: ThemeSetting): void;
  toggleSidebar(): void;
  setInspectorOpen(open: boolean): void;
  setCommandPaletteOpen(open: boolean): void;
  setEditorFontSize(size: number): void;
  setShowGrid(show: boolean): void;
  setShowEdges(show: boolean): void;
  setAutoRun(enabled: boolean): void;
  hydrate(): Promise<void>;
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolve(theme: ThemeSetting): 'light' | 'dark' {
  if (theme === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return theme;
}

/** The stylesheet keys off `data-theme`, so apply it at the document root. */
function applyTheme(resolved: 'light' | 'dark'): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', resolved);
  document.documentElement.style.colorScheme = resolved;
}

function persist(state: UiState): void {
  const preferences: StoredPreferences = {
    theme: state.theme,
    editorFontSize: state.editorFontSize,
    showGrid: state.showGrid,
    showEdges: state.showEdges,
    autoRun: state.autoRun,
  };
  void savePreferences(preferences);
}

export const useUiStore = create<UiState>((set, get) => ({
  view: 'dashboard',
  theme: DEFAULT_PREFERENCES.theme,
  resolvedTheme: resolve(DEFAULT_PREFERENCES.theme),
  editorFontSize: DEFAULT_PREFERENCES.editorFontSize,
  showGrid: DEFAULT_PREFERENCES.showGrid,
  showEdges: DEFAULT_PREFERENCES.showEdges,
  autoRun: DEFAULT_PREFERENCES.autoRun,
  sidebarCollapsed: false,
  inspectorOpen: true,
  commandPaletteOpen: false,
  hydrated: false,

  setView(view) {
    set({ view });
  },

  setTheme(theme) {
    const resolved = resolve(theme);
    applyTheme(resolved);
    set({ theme, resolvedTheme: resolved });
    persist(get());
  },

  toggleSidebar() {
    set({ sidebarCollapsed: !get().sidebarCollapsed });
  },

  setInspectorOpen(open) {
    set({ inspectorOpen: open });
  },

  setCommandPaletteOpen(open) {
    set({ commandPaletteOpen: open });
  },

  setEditorFontSize(size) {
    set({ editorFontSize: Math.min(24, Math.max(10, size)) });
    persist(get());
  },

  setShowGrid(show) {
    set({ showGrid: show });
    persist(get());
  },

  setShowEdges(show) {
    set({ showEdges: show });
    persist(get());
  },

  setAutoRun(enabled) {
    set({ autoRun: enabled });
    persist(get());
  },

  async hydrate() {
    const preferences = await loadPreferences();
    const resolved = resolve(preferences.theme);
    applyTheme(resolved);
    set({ ...preferences, resolvedTheme: resolved, hydrated: true });

    // Follow the OS while the user is on the `system` setting.
    if (typeof window !== 'undefined') {
      const query = window.matchMedia('(prefers-color-scheme: dark)');
      query.addEventListener('change', () => {
        if (get().theme !== 'system') return;
        const next = systemPrefersDark() ? 'dark' : 'light';
        applyTheme(next);
        set({ resolvedTheme: next });
      });
    }
  },
}));
