import { useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';
type ThemeState = { preference: ThemePreference; resolved: ResolvedTheme; transitioning: boolean; persistent: boolean };
type Transition = { ready: Promise<void>; finished: Promise<void>; skipTransition: () => void };
type TransitionDocument = Document & { startViewTransition?: (update: () => void) => Transition };
// Keep this compatibility key in sync with the pre-render bootstrap in index.html.
export const THEME_KEY = 'splitfree-theme';
const subscribers = new Set<() => void>();
let state: ThemeState | undefined;
let transition: Transition | undefined;
let generation = 0;
let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
let detach: (() => void) | undefined;

function media(query: string) { return typeof window.matchMedia === 'function' ? window.matchMedia(query) : undefined; }
export function validPreference(value: string | null): ThemePreference { return value === 'dark' || value === 'light' ? value : 'system'; }
export function resolveTheme(preference: ThemePreference): ResolvedTheme { return preference === 'system' ? (media('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light') : preference; }
function readPreference() { try { return validPreference(localStorage.getItem(THEME_KEY)); } catch { return 'system'; } }
function snapshot(): ThemeState {
  if (!state) state = { preference: readPreference(), resolved: resolveTheme(readPreference()), transitioning: false, persistent: true };
  return state;
}
function publish(next: ThemeState) { state = next; subscribers.forEach(listener => listener()); }
function applyTheme(theme: ResolvedTheme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#141d19' : '#f7f8f5');
}
function finish(version: number) {
  if (version !== generation) return;
  document.documentElement.removeAttribute('data-theme-transition');
  transition = undefined;
  publish({ ...snapshot(), transitioning: false });
}
function change(preference: ThemePreference, animate: boolean, persistent = snapshot().persistent) {
  const version = ++generation;
  transition?.skipTransition();
  transition = undefined;
  clearTimeout(fallbackTimer);
  document.documentElement.removeAttribute('data-theme-transition');
  const resolved = resolveTheme(preference);
  const changesColor = document.documentElement.dataset.theme !== resolved;
  const shouldAnimate = animate && changesColor && document.visibilityState !== 'hidden' && !media('(prefers-reduced-motion: reduce)')?.matches;
  publish({ preference, resolved, transitioning: shouldAnimate, persistent });
  const commit = () => {
    // A skipped transition still invokes its callback. Never let it undo a newer request.
    if (version !== generation) return;
    applyTheme(resolved);
    flushSync(() => subscribers.forEach(listener => listener()));
  };
  if (!shouldAnimate) { commit(); finish(version); return; }
  const start = (document as TransitionDocument).startViewTransition;
  // Native top-layer dialogs are not captured consistently across browser engines.
  // Keep their focus and form DOM intact, and transition their colors in place instead.
  if (start && !document.querySelector('dialog[open]')) {
    document.documentElement.dataset.themeTransition = 'snapshot';
    try {
      transition = start.call(document, commit);
      void transition.ready.catch(() => { /* A superseded capture may reject normally. */ });
      void transition.finished.then(() => finish(version), () => { commit(); finish(version); });
      return;
    } catch { /* Fall back if a browser exposes the API but cannot capture this document. */ }
  }
  document.documentElement.dataset.themeTransition = 'colors';
  // The old computed values are the start of the CSS transition, not an unthemed overlay.
  void document.documentElement.offsetWidth;
  commit();
  fallbackTimer = setTimeout(() => finish(version), 280);
}
export function setTheme(preference: ThemePreference) {
  let persistent = true;
  try { localStorage.setItem(THEME_KEY, preference); } catch { persistent = false; }
  change(preference, true, persistent);
}
function subscribe(listener: () => void) {
  subscribers.add(listener);
  if (subscribers.size === 1) {
    const scheme = media('(prefers-color-scheme: dark)');
    const motion = media('(prefers-reduced-motion: reduce)');
    const onScheme = () => { if (snapshot().preference === 'system') change('system', false); };
    const onStorage = (event: StorageEvent) => { if (event.key === THEME_KEY || event.key === null) change(validPreference(event.newValue), false); };
    const onMotion = () => { if (motion?.matches) change(snapshot().preference, false); };
    const onVisible = () => { if (document.visibilityState === 'visible') change(snapshot().preference, false); };
    scheme?.addEventListener('change', onScheme);
    motion?.addEventListener('change', onMotion);
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisible);
    applyTheme(snapshot().resolved);
    detach = () => {
      scheme?.removeEventListener('change', onScheme);
      motion?.removeEventListener('change', onMotion);
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }
  return () => {
    subscribers.delete(listener);
    if (!subscribers.size) {
      detach?.(); detach = undefined;
      generation++; transition?.skipTransition(); transition = undefined;
      clearTimeout(fallbackTimer);
      document.documentElement.removeAttribute('data-theme-transition');
      state = undefined;
    }
  };
}
export function useTheme() { return useSyncExternalStore(subscribe, snapshot, snapshot); }
