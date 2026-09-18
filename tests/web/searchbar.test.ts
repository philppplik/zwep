import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchBar } from '../../web/src/components.ts';
import * as client from '../../web/src/client.ts';

let bar: SearchBar;
const onSearch = vi.fn();

function input(): HTMLInputElement {
  return bar.el.querySelector<HTMLInputElement>('.z-search__input')!;
}

function type(value: string): void {
  input().value = value;
  input().dispatchEvent(new Event('input', { bubbles: true }));
}

async function flushSuggest(): Promise<void> {
  // The suggestion fetch is debounced by 180 ms.
  await new Promise((r) => setTimeout(r, 260));
}

beforeEach(() => {
  vi.clearAllMocks();
  bar = new SearchBar(onSearch);
  document.body.appendChild(bar.el);
});

afterEach(() => {
  // A SearchBar owns a debounce timer and two document-level listeners. Leaving
  // one alive lets its pending suggestion request fire during the next test.
  bar.destroy();
});

describe('submitting', () => {
  it('reports the trimmed query', () => {
    type('  climate policy  ');
    bar.el.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(onSearch).toHaveBeenCalledWith('climate policy');
  });

  it('ignores an empty submit', () => {
    type('   ');
    bar.el.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(onSearch).not.toHaveBeenCalled();
  });
});

describe('clear button', () => {
  it('appears only once there is text', () => {
    const clear = bar.el.querySelector<HTMLButtonElement>('.z-search__clear')!;
    expect(clear.hidden).toBe(true);
    type('a');
    expect(clear.hidden).toBe(false);
    clear.click();
    expect(input().value).toBe('');
    expect(clear.hidden).toBe(true);
  });
});

describe('suggestions', () => {
  it('does not query for a single character', async () => {
    const spy = vi.spyOn(client, 'suggest').mockResolvedValue([]);
    type('c');
    await flushSuggest();
    expect(spy).not.toHaveBeenCalled();
  });

  it('renders suggestions as ARIA options', async () => {
    vi.spyOn(client, 'suggest').mockResolvedValue([
      { text: 'climate policy', url: 'https://a', type: 'article' },
      { text: 'climate data', url: 'https://b', type: 'page' },
    ]);
    type('cli');
    await flushSuggest();

    const box = bar.el.querySelector('.z-suggest')!;
    expect(box.hasAttribute('hidden')).toBe(false);
    expect(box.getAttribute('role')).toBe('listbox');
    expect(box.querySelectorAll('[role="option"]')).toHaveLength(2);
    expect(input().getAttribute('aria-expanded')).toBe('true');
  });

  it('escapes suggestion text', async () => {
    vi.spyOn(client, 'suggest').mockResolvedValue([
      { text: '<img src=x onerror=alert(1)>', url: 'https://a', type: 'page' },
    ]);
    type('img');
    await flushSuggest();
    expect(bar.el.querySelector('.z-suggest img')).toBeNull();
  });

  it('moves the active option with the arrow keys', async () => {
    vi.spyOn(client, 'suggest').mockResolvedValue([
      { text: 'one', url: 'https://a', type: 'page' },
      { text: 'two', url: 'https://b', type: 'page' },
    ]);
    type('on');
    await flushSuggest();

    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(input().getAttribute('aria-activedescendant')).toBe('z-suggest-0');
    expect(bar.el.querySelectorAll('[role="option"]')[0].getAttribute('aria-selected')).toBe('true');

    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(input().getAttribute('aria-activedescendant')).toBe('z-suggest-1');
  });

  it('searches the highlighted suggestion on Enter', async () => {
    vi.spyOn(client, 'suggest').mockResolvedValue([
      { text: 'climate policy', url: 'https://a', type: 'page' },
    ]);
    type('cli');
    await flushSuggest();
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onSearch).toHaveBeenCalledWith('climate policy');
  });

  it('closes the list on Escape and clears the ARIA state', async () => {
    vi.spyOn(client, 'suggest').mockResolvedValue([{ text: 'one', url: 'https://a', type: 'page' }]);
    type('on');
    await flushSuggest();
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(bar.el.querySelector('.z-suggest')!.hasAttribute('hidden')).toBe(true);
    expect(input().getAttribute('aria-expanded')).toBe('false');
  });

  it('closes the list when the user clicks elsewhere', async () => {
    vi.spyOn(client, 'suggest').mockResolvedValue([{ text: 'one', url: 'https://a', type: 'page' }]);
    type('on');
    await flushSuggest();
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(bar.el.querySelector('.z-suggest')!.hasAttribute('hidden')).toBe(true);
  });

  it('hides the list when a request fails, rather than showing stale items', async () => {
    vi.spyOn(client, 'suggest').mockRejectedValue(new Error('offline'));
    type('cli');
    await flushSuggest();
    expect(bar.el.querySelector('.z-suggest')!.hasAttribute('hidden')).toBe(true);
  });

  it('debounces rapid typing into a single request', async () => {
    const spy = vi.spyOn(client, 'suggest').mockResolvedValue([]);
    type('cl');
    type('cli');
    type('clim');
    await flushSuggest();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('clim', 8, expect.anything());
  });
});

describe('teardown', () => {
  it('stops listening to the document after destroy', async () => {
    const spy = vi.spyOn(client, 'suggest').mockResolvedValue([]);
    bar.destroy();
    type('climate');
    await flushSuggest();
    expect(spy).not.toHaveBeenCalled();
  });
});
