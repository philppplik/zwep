import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  applyTheme,
  loadSettings,
  onSettingsChange,
  resetSettingsCache,
  saveSettings,
} from '../../web/src/settings.ts';

beforeEach(() => {
  localStorage.clear();
  resetSettingsCache();
});

describe('loadSettings', () => {
  it('returns the defaults on a fresh install', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('merges stored values over the defaults', () => {
    localStorage.setItem('zwep.settings', JSON.stringify({ semantic: true }));
    const s = loadSettings();
    expect(s.semantic).toBe(true);
    expect(s.resultsPerPage).toBe(DEFAULT_SETTINGS.resultsPerPage);
  });

  it('falls back to the defaults when storage is corrupt', () => {
    localStorage.setItem('zwep.settings', 'not json');
    expect(() => loadSettings()).not.toThrow();
    expect(loadSettings().theme).toBe('system');
  });

  it('migrates the admin key from the pre-0.2 storage key', () => {
    localStorage.setItem('zwep-admin-key', 'legacy_key');
    expect(loadSettings().adminKey).toBe('legacy_key');
  });

  it('migrates the pre-0.2 theme key', () => {
    localStorage.setItem('zwep-theme', 'dark');
    expect(loadSettings().theme).toBe('dark');
  });
});

describe('saveSettings', () => {
  it('persists a partial patch and keeps the rest', () => {
    saveSettings({ semantic: true });
    resetSettingsCache();
    const s = loadSettings();
    expect(s.semantic).toBe(true);
    expect(s.overview).toBe(false);
  });

  it('notifies subscribers', () => {
    const fn = vi.fn();
    const off = onSettingsChange(fn);
    saveSettings({ overview: true });
    expect(fn).toHaveBeenCalledWith(expect.objectContaining({ overview: true }));
    off();
    saveSettings({ overview: false });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('still applies in memory when storage is unavailable', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => saveSettings({ semantic: true })).not.toThrow();
    expect(loadSettings().semantic).toBe(true);
    spy.mockRestore();
  });
});

describe('applyTheme', () => {
  it('sets the theme attribute for an explicit choice', () => {
    expect(applyTheme('dark')).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('resolves "system" from the OS preference', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn() }),
    );
    expect(applyTheme('system')).toBe('dark');
    vi.unstubAllGlobals();
  });

  it('sets color-scheme so native form controls match', () => {
    applyTheme('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });
});
