// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import App from '../src/App';
let root: Root;
let host: HTMLDivElement;
const button = (name: string) => Array.from(host.querySelectorAll('button')).find(el => el.textContent?.trim() === name) as HTMLButtonElement;
async function click(el: HTMLElement) { await act(async () => { el.click(); }); }
async function input(el: HTMLInputElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }); }
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root.render(<App />); });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
describe('app flows', () => {
  it('opens a persistent demo and navigates groups and insights', async () => {
    expect(host.textContent).toContain('Make yourself at home.');
    await click(button('Explore the demo'));
    expect(host.textContent).toContain('Less figuring. More living.');
    expect(localStorage.getItem('splitfree-mode')).toBe('demo');
    const group = host.querySelector('.group-card') as HTMLElement;
    await click(group);
    expect(host.querySelector('h1')?.textContent).toBe('Goa, with the gang');
    await click(button('Group insights'));
    expect(host.textContent).toContain('Your money, in perspective.');
    expect(host.querySelector('.donut')).not.toBeNull();
  });
  it('creates a group from the dashboard and keeps it in local storage', async () => {
    await click(button('Explore the demo'));
    await click(button('New group'));
    const name = host.querySelector('dialog input') as HTMLInputElement;
    await input(name, 'Hiking buddies');
    await act(async () => { host.querySelector('dialog form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(host.querySelector('h1')?.textContent).toBe('Hiking buddies');
    expect(localStorage.getItem('splitfree-demo-v1')).toContain('Hiking buddies');
  });
  it('records an equal expense and an audit entry', async () => {
    await click(button('Explore the demo'));
    await click(button('Add expense'));
    const inputs = host.querySelectorAll('dialog input');
    await input(inputs[1] as HTMLInputElement, 'A test dinner');
    await input(inputs[2] as HTMLInputElement, '100.01');
    await act(async () => { host.querySelector('dialog form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(host.querySelector('dialog')).toBeNull();
    const data = JSON.parse(localStorage.getItem('splitfree-demo-v1')!);
    const expense = data.groups[0].expenses.find((e: {
      description: string;
    }) => e.description === 'A test dinner');
    expect(expense.amount).toBe(10001);
    expect(expense.splits.reduce((sum: number, s: {
      owed: number;
    }) => sum + s.owed, 0)).toBe(10001);
    expect(data.groups[0].audit[0].action).toBe('Added expense');
  });
  it('keeps an open expense draft intact while changing appearance', async () => {
    await click(button('Explore the demo'));
    await click(button('Add expense'));
    const dialog = host.querySelector('dialog')!;
    const description = dialog.querySelectorAll('input')[1] as HTMLInputElement;
    await input(description, 'Keep this dinner draft');
    const toggle = host.querySelector('[aria-label="Switch to dark mode"]') as HTMLButtonElement;
    await click(toggle);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(host.querySelector('dialog')).toBe(dialog);
    expect(description.value).toBe('Keep this dinner draft');
    expect(dialog.hasAttribute('open')).toBe(true);
  });
  it('records a settlement that reduces outstanding debt', async () => {
    await click(button('Explore the demo'));
    await click(button('Let’s square things up'));
    const before = JSON.parse(localStorage.getItem('splitfree-demo-v1')!);
    const payment = Array.from(host.querySelectorAll('dialog button')).find(b => b.textContent?.includes('Record payment') && !(b as HTMLButtonElement).disabled) as HTMLElement;
    await click(payment);
    expect(JSON.parse(localStorage.getItem('splitfree-demo-v1')!).groups.flatMap((g: { expenses: unknown[] }) => g.expenses).length).toBe(before.groups.flatMap((g: { expenses: unknown[] }) => g.expenses).length);
    await click(button('Confirm payment'));
    const after = JSON.parse(localStorage.getItem('splitfree-demo-v1')!);
    expect(after.groups.flatMap((g: {
      expenses: unknown[];
    }) => g.expenses).length).toBe(before.groups.flatMap((g: {
      expenses: unknown[];
    }) => g.expenses).length + 1);
    expect(after.groups.flatMap((g: {
      expenses: {
        splitType: string;
      }[];
    }) => g.expenses).some((e: {
      splitType: string;
    }) => e.splitType === 'SETTLEMENT')).toBe(true);
  });
  it('restores a closed draft and clears it only after a successful save', async () => {
    await click(button('Explore the demo')); await click(button('Add expense'));
    const inputs = host.querySelectorAll('dialog input'); await input(inputs[1] as HTMLInputElement, 'Do not lose this dinner'); await input(inputs[2] as HTMLInputElement, '45.67');
    const key = 'splitfree-expense-draft-demo-me'; expect(localStorage.getItem(key)).toContain('Do not lose this dinner');
    await act(async () => root.unmount()); root = createRoot(host); await act(async () => root.render(<App />));
    await click(button('Add expense'));
    expect((host.querySelectorAll('dialog input')[1] as HTMLInputElement).value).toBe('Do not lose this dinner');
    expect(host.textContent).toContain('saved draft');
    await act(async () => { host.querySelector('dialog form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(localStorage.getItem(key)).toBeNull();
  });
  it('records a partial payment and can undo just its ledger record', async () => {
    await click(button('Explore the demo')); await click(button('Let’s square things up'));
    const payment = Array.from(host.querySelectorAll('dialog button')).find(b => b.textContent?.includes('Record payment') && !(b as HTMLButtonElement).disabled) as HTMLElement;
    await click(payment); await input(host.querySelector('.payment-review input') as HTMLInputElement, '100'); await click(button('Confirm payment'));
    let data = JSON.parse(localStorage.getItem('splitfree-demo-v1')!); const entry = data.groups.flatMap((g: { expenses: { splitType: string; id: string; amount: number; description: string }[] }) => g.expenses).find((e: { splitType: string }) => e.splitType === 'SETTLEMENT'); expect(entry.amount).toBe(10000);
    const row = Array.from(host.querySelectorAll('.expense-row')).find(el => el.textContent?.includes(entry.description)) as HTMLElement; await click(row); await click(button('Undo payment record')); await click(button('Yes, undo record'));
    data = JSON.parse(localStorage.getItem('splitfree-demo-v1')!); expect(data.groups.flatMap((g: { expenses: { id: string }[] }) => g.expenses).some((e: { id: string }) => e.id === entry.id)).toBe(false);
    expect(data.groups.flatMap((g: { audit: { action: string }[] }) => g.audit).some((a: { action: string }) => a.action === 'Reversed payment')).toBe(true);
  });
  it('restores a deleted expense from Activity with the original shares', async () => {
    await click(button('Explore the demo'));
    const data = JSON.parse(localStorage.getItem('splitfree-demo-v1')!); const original = data.groups[0].expenses[0];
    const row = Array.from(host.querySelectorAll('.expense-row')).find(el => el.textContent?.includes(original.description)) as HTMLElement; await click(row); await click(button('Delete')); await click(button('Yes, delete expense')); await click(button('Activity'));
    await click(button('Restore expense'));
    const restored = JSON.parse(localStorage.getItem('splitfree-demo-v1')!).groups[0].expenses.find((e: { id: string }) => e.id === original.id); expect(restored).toEqual(original); expect(button('Restore expense')).toBeUndefined();
  });
  it('saves group split defaults and applies them to new bills', async () => {
    await click(button('Explore the demo')); await click(host.querySelector('.group-card') as HTMLElement); await click(button('Split defaults'));
    const select = host.querySelector('dialog select') as HTMLSelectElement;
    await act(async () => { select.value = 'PERCENT'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    let checks = host.querySelectorAll('dialog input[type="checkbox"]'); await click(checks[2] as HTMLElement); checks = host.querySelectorAll('dialog input[type="checkbox"]'); await click(checks[3] as HTMLElement);
    const weights = host.querySelectorAll('dialog input[inputmode="decimal"]'); await input(weights[0] as HTMLInputElement, '60'); await input(weights[1] as HTMLInputElement, '40');
    await act(async () => { host.querySelector('dialog form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await click(button('Add expense')); expect((host.querySelector('[aria-label="Split method"]') as HTMLSelectElement).value).toBe('PERCENT');
    const inputs = host.querySelectorAll('dialog input'); await input(inputs[1] as HTMLInputElement, 'A usual bill'); await input(inputs[2] as HTMLInputElement, '100');
    await act(async () => { host.querySelector('dialog form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    const latest = JSON.parse(localStorage.getItem('splitfree-demo-v1')!).groups[0].expenses[0]; expect(latest.splits.map((s: { owed: number }) => s.owed)).toEqual([6000, 4000, 0, 0]);
  });

});

it('opens the notification inbox from the persistent header bell',async()=>{
 await click(button('Explore the demo'));
 const bell=host.querySelector('button[aria-label="Notifications"]') as HTMLButtonElement;
 expect(bell).not.toBeNull();await click(bell);
 expect(host.querySelector('h1')?.textContent).toBe('Notifications');
 expect(host.textContent).toContain('Notifications live in your real workspace');
});
