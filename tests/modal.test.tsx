// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { Modal } from '../src/components';
let root: Root; let host: HTMLDivElement;
function Harness() {  
const [open, setOpen] = useState(false); return <>
    <button onClick={() => setOpen(true)}>Open editor</button>{open && <Modal title="Editor" close={() => setOpen(false)}>
      <input aria-label="Draft" defaultValue="Unsaved" />
    </Modal>}</>;
}
beforeEach(async () => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); vi.useFakeTimers(); HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); }; HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); }; vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList); host = document.createElement('div'); document.body.append(host); root = createRoot(host); await act(async () => root.render(<Harness />)); host.querySelector('button')!.focus(); await act(async () => host.querySelector('button')!.click()); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.useRealTimers(); });
it('keeps the dialog mounted for a short exit and restores trigger focus', async () => { await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Close dialog"]')!.click()); expect(host.querySelector('dialog')!.dataset.closing).toBe('true'); await act(async () => vi.advanceTimersByTime(180)); expect(host.querySelector('dialog')).toBeNull(); expect(document.activeElement).toBe(host.querySelector('button')); });
it('handles Escape without closing the native dialog before its exit', async () => { const cancel = new Event('cancel', { cancelable: true }); await act(async () => host.querySelector('dialog')!.dispatchEvent(cancel)); expect(cancel.defaultPrevented).toBe(true); expect(host.querySelector('dialog')!.hasAttribute('open')).toBe(true); await act(async () => vi.advanceTimersByTime(180)); expect(host.querySelector('dialog')).toBeNull(); });
it('closes immediately when reduced motion is requested', async () => { vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList); await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Close dialog"]')!.click()); expect(host.querySelector('dialog')).toBeNull(); });
