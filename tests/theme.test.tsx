// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { setTheme, useTheme, THEME_KEY } from '../src/lib/theme';
import { ThemeSettings, ThemeToggle } from '../src/ThemeControls';
let host: HTMLDivElement;
let root: Root;
let dark = false;
let reduced = false;
const listeners = new Map<string, Set<() => void>>();
function Harness() {
  const theme = useTheme();
  return <>
    <ThemeToggle />
    <ThemeSettings />
    <input aria-label="Unsaved draft" defaultValue="Dinner with friends" />
    <output>{JSON.stringify(theme)}</output>
  </>;
}
function current() { return JSON.parse(host.querySelector('output')!.textContent!); }
async function choose(value: 'light' | 'dark' | 'system') { await act(async () => setTheme(value)); }
async function emit(query: string) { await act(async () => listeners.get(query)?.forEach(listener => listener())); }
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  dark = false; reduced = false; listeners.clear(); localStorage.clear();
  document.documentElement.dataset.theme = 'light';
  document.documentElement.style.colorScheme = 'light';
  document.head.innerHTML = '<meta name="theme-color" content="#f7f8f5"/>';
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.spyOn(window, 'matchMedia').mockImplementation(query => ({
    media: query,
    get matches() { return query.includes('reduced-motion') ? reduced : dark; },
    addEventListener: (_: string, listener: () => void) => { if (!listeners.has(query)) listeners.set(query, new Set()); listeners.get(query)!.add(listener); },
    removeEventListener: (_: string, listener: () => void) => listeners.get(query)?.delete(listener),
  } as unknown as MediaQueryList));
  Object.defineProperty(document, 'startViewTransition', { configurable: true, writable: true, value: undefined });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
  delete (document as unknown as { startViewTransition?: unknown }).startViewTransition;
});
describe('appearance state', () => {
  it('persists dark mode and updates native browser colors without replacing the form', async () => {
    const input = host.querySelector('input')!;
    input.value = 'My unsaved dinner'; input.focus();
    await choose('dark');
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(document.querySelector('meta[name="theme-color"]')!.getAttribute('content')).toBe('#141d19');
    expect(host.querySelector('input')).toBe(input);
    expect(input.value).toBe('My unsaved dinner');
    expect(document.activeElement).toBe(input);
  });
  it('follows system changes only in system mode', async () => {
    dark = true; await emit('(prefers-color-scheme: dark)');
    expect(current().preference).toBe('system'); expect(current().resolved).toBe('dark');
    await choose('light'); dark = false; await emit('(prefers-color-scheme: dark)');
    dark = true; await emit('(prefers-color-scheme: dark)');
    expect(current().resolved).toBe('light');
    await choose('system'); expect(current().resolved).toBe('dark');
  });
  it('responds to cross-tab changes and resets to the system when preference is removed', async () => {
    await act(async () => window.dispatchEvent(new StorageEvent('storage', { key: THEME_KEY, newValue: 'dark' })));
    expect(current().resolved).toBe('dark');
    await act(async () => window.dispatchEvent(new StorageEvent('storage', { key: THEME_KEY, newValue: null })));
    expect(current().preference).toBe('system'); expect(current().resolved).toBe('light');
  });
  it('changes for the current visit when preference storage is unavailable', async () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw new Error('Blocked'); } });
    await choose('dark'); expect(current().resolved).toBe('dark'); expect(current().persistent).toBe(false);
    expect(host.textContent).toContain('could not save');
  });
  it('cleans up the color fallback after it finishes', async () => {
    vi.useFakeTimers(); await choose('dark');
    expect(document.documentElement.dataset.themeTransition).toBe('colors');
    expect(current().transitioning).toBe(true);
    await act(async () => vi.advanceTimersByTime(300));
    expect(current().transitioning).toBe(false); expect(document.documentElement.hasAttribute('data-theme-transition')).toBe(false);
  });
  it('respects reduced motion and skips captures while the document is hidden', async () => {
    const capture = vi.fn(); Object.assign(document, { startViewTransition: capture });
    reduced = true; await choose('dark'); expect(capture).not.toHaveBeenCalled(); expect(current().transitioning).toBe(false);
    reduced = false; vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await choose('light'); expect(capture).not.toHaveBeenCalled(); expect(current().resolved).toBe('light');
  });
  it('prevents a skipped capture callback from undoing a newer theme', async () => {
    const captures: { commit: () => void; finish: () => void; skip: ReturnType<typeof vi.fn> }[] = [];
    const capture = vi.fn((commit: () => void) => {
      let finish!: () => void;
      const finished = new Promise<void>(resolve => { finish = resolve; });
      const skip = vi.fn(); captures.push({ commit, finish, skip });
      return { ready: Promise.resolve(), finished, skipTransition: skip };
    });
    Object.assign(document, { startViewTransition: capture });
    await choose('dark'); await choose('light');
    expect(captures[0].skip).toHaveBeenCalled();
    await act(async () => { captures[0].commit(); captures[0].finish(); });
    expect(document.documentElement.dataset.theme).toBe('light');
    await choose('dark');
    await act(async () => { captures[1].commit(); captures[1].finish(); });
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(current().transitioning).toBe(false);
  });
  it('falls back when a browser cannot create a snapshot', async () => {
    Object.assign(document, { startViewTransition: () => { throw new Error('Capture unavailable'); } });
    await choose('dark'); expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.themeTransition).toBe('colors');
  });
  it('uses in-place colors for an open top-layer dialog', async () => {
    const dialog = document.createElement('dialog'); dialog.setAttribute('open', ''); host.append(dialog);
    const capture = vi.fn(); Object.assign(document, { startViewTransition: capture });
    await choose('dark'); expect(capture).not.toHaveBeenCalled(); expect(dialog.hasAttribute('open')).toBe(true);
    expect(document.documentElement.dataset.themeTransition).toBe('colors');
  });
});
describe('pre-render theme bootstrap', () => {
  const html = readFileSync('index.html', 'utf8');
  const bootstrap = html.match(/<script>([\s\S]*?)<\/script>/)![1];
  function boot(stored: string | null, systemDark: boolean, unavailable = false) {
    const root = { dataset: {} as { theme?: string }, style: {} as { colorScheme?: string } };
    let chrome = '';
    new Function('document', 'localStorage', 'matchMedia', bootstrap)(
      { documentElement: root, querySelector: () => ({ setAttribute: (_: string, value: string) => { chrome = value; } }) },
      { getItem: () => { if (unavailable) throw new Error('Blocked'); return stored; } },
      () => ({ matches: systemDark }),
    );
    return { ...root, chrome };
  }
  it('applies saved dark before the React bundle and any page markup', () => {
    expect(html.indexOf('<script>')).toBeLessThan(html.indexOf('<body>'));
    expect(boot('dark', false).dataset.theme).toBe('dark');
    expect(boot('dark', false).style.colorScheme).toBe('dark');
    expect(boot('light', true).dataset.theme).toBe('light');
  });
  it('uses the system with invalid or inaccessible storage', () => {
    expect(boot('invalid', true).dataset.theme).toBe('dark');
    expect(boot(null, true, true).dataset.theme).toBe('dark');
    expect(boot(null, false).dataset.theme).toBe('light');
  });
});
