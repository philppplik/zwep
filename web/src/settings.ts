/**
 * User settings, persisted in `localStorage`.
 *
 * The admin key lives here too. It is a *local* secret for a self-hosted tool,
 * and it is only ever sent as an `x-admin-key` header — never in a URL, and
 * never to any origin other than the one serving the app.
 */

export type Theme = 'light' | 'dark' | 'system';
export type LlmProvider = 'none' | 'ollama' | 'openrouter';

export interface ZwepSettings {
  theme: Theme;
  semantic: boolean;
  overview: boolean;
  resultsPerPage: number;
  llmProvider: LlmProvider;
  ollamaModel: string;
  openrouterModel: string;
  openrouterKey: string;
  adminKey: string;
  /** Check npm for a newer release once a day. */
  autoUpdateCheck: boolean;
}

export const DEFAULT_SETTINGS: ZwepSettings = {
  theme: 'system',
  semantic: false,
  overview: false,
  resultsPerPage: 20,
  llmProvider: 'none',
  ollamaModel: 'llama3.1',
  openrouterModel: 'openai/gpt-4o-mini',
  openrouterKey: '',
  adminKey: '',
  autoUpdateCheck: true,
};

const KEY = 'zwep.settings';
/** Key used by the pre-0.2 UI, migrated on first load. */
const LEGACY_ADMIN_KEY = 'zwep-admin-key';
const LEGACY_THEME_KEY = 'zwep-theme';

const listeners = new Set<(s: ZwepSettings) => void>();

function read(): ZwepSettings {
  let stored: Partial<ZwepSettings> = {};
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) stored = JSON.parse(raw) as Partial<ZwepSettings>;
  } catch {
    /* corrupt storage falls back to defaults rather than breaking the app */
  }
  const merged = { ...DEFAULT_SETTINGS, ...stored };
  // One-time migration from the pre-0.2 storage keys.
  try {
    if (!stored.adminKey) merged.adminKey = localStorage.getItem(LEGACY_ADMIN_KEY) ?? '';
    if (!stored.theme) {
      const legacy = localStorage.getItem(LEGACY_THEME_KEY);
      if (legacy === 'dark' || legacy === 'light') merged.theme = legacy;
    }
  } catch {
    /* private-mode browsers deny storage access entirely */
  }
  return merged;
}

let cache: ZwepSettings | null = null;

export function loadSettings(): ZwepSettings {
  if (!cache) cache = read();
  return cache;
}

export function saveSettings(patch: Partial<ZwepSettings>): ZwepSettings {
  const next = { ...loadSettings(), ...patch };
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage may be full or blocked; the in-memory value still applies */
  }
  for (const fn of listeners) fn(next);
  return next;
}

export function onSettingsChange(fn: (s: ZwepSettings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Test seam: forget the cached settings. */
export function resetSettingsCache(): void {
  cache = null;
}

/**
 * Resolve `system` to the OS preference and apply it to `<html>`.
 * Returns the concrete theme that is now active.
 */
export function applyTheme(theme: Theme): 'light' | 'dark' {
  const resolved =
    theme === 'system'
      ? window.matchMedia?.('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : theme;
  document.documentElement.setAttribute('data-theme', resolved);
  document.documentElement.style.colorScheme = resolved;
  return resolved;
}
