// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { usePwaInstall } from '../src/lib/install';
import { InstallButton, InstallPromotion } from '../src/InstallApp';
let root: Root; let host: HTMLDivElement; let install: ReturnType<typeof usePwaInstall>; let runningStandalone = false;
function Harness() {  
install = usePwaInstall(); return <>
    <InstallButton controller={install} compact />
    <InstallPromotion controller={install} />
  </>;
}
async function mount() { await act(async () => root.render(<Harness />)); }
function offer(prompt: ReturnType<typeof vi.fn>) { const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt }); return event; }
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); sessionStorage.clear(); runningStandalone = false; vi.spyOn(window, 'matchMedia').mockImplementation(query => ({ get matches() { return query.includes('standalone') ? runningStandalone : query.includes('max-width'); }, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList)); vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 Android Mobile'); HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); }; HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); }; host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
it('shows the mobile install option before a browser offers its prompt', async () => { await mount(); expect(host.querySelector('[aria-label="Install faircrumb"]')).not.toBeNull(); expect(install.available).toBe(false); });
it('consumes a deferred native prompt only once and hides controls after installation', async () => { await mount(); const prompt = vi.fn().mockResolvedValue({ outcome: 'accepted' }); const event = offer(prompt); await act(async () => window.dispatchEvent(event)); expect(event.defaultPrevented).toBe(true); await act(async () => { expect(await install.request()).toBe('accepted'); }); expect(prompt).toHaveBeenCalledTimes(1); await act(async () => { expect(await install.request()).toBe('manual'); }); await act(async () => window.dispatchEvent(new Event('appinstalled'))); expect(install.installed).toBe(true); expect(host.querySelector('button')).toBeNull(); });
it('prevents rapid clicks from opening the same native prompt twice', async () => { await mount(); let resolve!: (value: { outcome: string }) => void; const prompt = vi.fn(() => new Promise(r => { resolve = r; })); await act(async () => window.dispatchEvent(offer(prompt))); let pending!: ReturnType<typeof install.request>; await act(async () => { pending = install.request(); expect(await install.request()).toBe('busy'); }); await act(async () => { resolve({ outcome: 'dismissed' }); await pending; }); expect(prompt).toHaveBeenCalledTimes(1); expect(install.pending).toBe(false); expect(install.installed).toBe(false); });
it('offers manual instructions when a native prompt fails', async () => { await mount(); await act(async () => window.dispatchEvent(offer(vi.fn().mockRejectedValue(new Error('Unavailable'))))); await act(async () => { expect(await install.request()).toBe('manual'); }); expect(install.message).toContain('could not open'); expect(install.pending).toBe(false); });
it('shows iPhone Add to Home Screen steps instead of pretending to download a file', async () => { vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 iPhone'); await mount(); const button = Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes('Install app'))!; await act(async () => button.click()); const dialog = host.querySelector('dialog')!; expect(dialog.textContent).toContain('Safari'); expect(dialog.textContent).toContain('Add to Home Screen'); expect(dialog.textContent).toContain('Open as Web App'); });
it('recognizes a standalone launch without showing the promotion', async () => { runningStandalone = true; await mount(); expect(install.installed).toBe(true); expect(host.querySelector('button')).toBeNull(); });
it('keeps a header install entry after dismissing the mobile promotion', async () => { await mount(); await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Dismiss install suggestion"]')!.click()); expect(host.querySelector('.install-promotion')).toBeNull(); expect(host.querySelector('.install-header')).not.toBeNull(); expect(sessionStorage.getItem('splitfree-install-dismissed')).toBe('true'); });
