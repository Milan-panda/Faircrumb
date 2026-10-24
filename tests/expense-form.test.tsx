// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ExpenseForm from '../src/ExpenseForm';
import { demoGroups } from '../src/lib/demo';
import { draftKey } from '../src/lib/drafts';
let root: Root; let host: HTMLDivElement;
const groups = demoGroups();
async function input(element: HTMLInputElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); }); }
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); localStorage.clear(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
it('retains the draft and reports failure when the ledger cannot save', async () => { const save = vi.fn(() => false); await act(async () => root.render(<ExpenseForm groups={groups} initialGroup={groups[0].id} me="demo-me" onSave={save} />)); const inputs = host.querySelectorAll('input'); await input(inputs[1], 'A bill worth keeping'); await input(inputs[2], '123.45'); await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); expect(save).toHaveBeenCalled(); expect(localStorage.getItem(draftKey('demo-me'))).toContain('A bill worth keeping'); expect(host.querySelector('[role="alert"]')?.textContent).toContain('draft is retained'); });
it('does not crash if draft storage is denied', async () => { vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw new Error('Denied'); }, removeItem: () => { throw new Error('Denied'); } }); await act(async () => root.render(<ExpenseForm groups={groups} initialGroup={groups[0].id} me="demo-me" onSave={() => false} />)); expect(host.textContent).toContain('could not save this draft'); await input(host.querySelectorAll('input')[1], 'Still editable'); expect((host.querySelectorAll('input')[1]).value).toBe('Still editable'); });
