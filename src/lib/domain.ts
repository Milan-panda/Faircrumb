export type Member = {
  id: string;
  name: string;
  username: string;
  ghost?: boolean;
  upi?: string;
};
export type Split = {
  memberId: string;
  paid: number;
  owed: number;
};
export type Expense = {
  id: string;
  description: string;
  amount: number;
  category: string;
  date: string;
  splitType: string;
  excluded: boolean;
  splits: Split[];
  receipt?: string;
  splitValues?: Record<string, string>;
  extra?: string;
};
export type SplitDefault = { mode: 'EQUAL' | 'PERCENT' | 'SHARES'; participants: string[]; values: Record<string, string> };
export type Audit = {
  id: string;
  at: string;
  actor: string;
  action: string;
  description: string;
  expenseId?: string;
  before?: Expense;
  after?: Expense;
};
export type Group = {
  id: string;
  name: string;
  category: string;
  currency: 'INR';
  members: Member[];
  expenses: Expense[];
  audit: Audit[];
  revision: number;
  defaultSplit?: SplitDefault;
};
export type Profile = Member & {
  hasPassword?: boolean;
};
export function localDate(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
export const uid = () => crypto.randomUUID();
const inrFormatter = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
export const money = (paise: number) => inrFormatter.format(paise / 100);
export function cents(value: string): number {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim()))
    throw new Error('Enter a positive amount with at most two decimals.');
  const [whole, fraction = ''] = value.trim().split('.');
  const n = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(n) || n > 999999999999)
    throw new Error('Amount is too large.');
  return n;
}
export function allocate(total: number, weights: number[]): number[] {
  if (!Number.isSafeInteger(total) || total < 0 || !weights.length || weights.some(w => !Number.isFinite(w) || w < 0) || weights.reduce((a, b) => a + b, 0) <= 0)
    throw new Error('Choose participants and use valid positive weights.');
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!Number.isFinite(sum))
    throw new Error('The combined split weights are too large.');
  const raw = weights.map(w => w / sum * total);
  const result = raw.map(Math.floor);
  const order = raw.map((v, i) => ({ i, r: v - result[i] })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (let left = total - result.reduce((a, b) => a + b, 0), i = 0; left > 0; left--, i++)
    result[order[i % order.length].i]++;
  return result;
}
export function splitAmounts(total: number, mode: string, values: string[], extra = 0): number[] {
  if (mode === 'EQUAL')
    return allocate(total, values.map(() => 1));
  if (mode === 'EXACT') {
    const amounts = values.map(cents);
    if (amounts.reduce((a, b) => a + b, 0) !== total)
      throw new Error('Exact shares must add up to the bill total.');
    return amounts;
  }
  if (mode === 'ITEMIZED') {
    const items = values.map(cents);
    const subtotal = items.reduce((a, b) => a + b, 0);
    if (subtotal + extra !== total)
      throw new Error('Items plus tax, tip and discount must equal the bill total.');
    return allocate(total, items);
  }
  const weights = values.map(v => Number(v));
  if (values.some(v => !v.trim()) || weights.some(w => !Number.isFinite(w) || w < 0))
    throw new Error('Enter a valid value for each participant.');
  if (mode === 'PERCENT' && Math.abs(weights.reduce((a, b) => a + b, 0) - 100) > 0.000001)
    throw new Error('Percentages must add up to 100.');
  return allocate(total, weights);
}
export function balances(group: Group): Record<string, number> {
  const b: Record<string, number> = Object.fromEntries(group.members.map(m => [m.id, 0]));
  group.expenses.forEach(e => e.splits.forEach(s => b[s.memberId] = (b[s.memberId] || 0) + s.paid - s.owed));
  return b;
}
export function debts(group: Group) {
  const entries = Object.entries(balances(group));
  const debtors = entries.filter(([, v]) => v < 0).map(([id, v]) => ({ id, amount: -v })).sort((a, b) => b.amount - a.amount);
  const creditors = entries.filter(([, v]) => v > 0).map(([id, v]) => ({ id, amount: v })).sort((a, b) => b.amount - a.amount);
  const out: {
    from: string;
    to: string;
    amount: number;
  }[] = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].amount, creditors[j].amount);
    out.push({ from: debtors[i].id, to: creditors[j].id, amount });
    debtors[i].amount -= amount;
    creditors[j].amount -= amount;
    if (!debtors[i].amount)
      i++;
    if (!creditors[j].amount)
      j++;
  }
  return out;
}
export function lensAmount(e: Expense, lens: string, me: string) {
  if (lens === 'cash')
    return e.splits.find(s => s.memberId === me)?.paid || 0;
  if (e.excluded || e.splitType === 'SETTLEMENT')
    return 0;
  return lens === 'group' ? e.amount : e.splits.find(s => s.memberId === me)?.owed || 0;
}
export const categories = ['Food & drinks', 'Travel', 'Stay', 'Groceries', 'Rent', 'Utilities', 'Other'];
export const categoryIcons: Record<string, string> = { 'Food & drinks': '🍜', Travel: '🚕', Stay: '🏡', Groceries: '🥑', Rent: '🔑', Utilities: '💡', Other: '🧾', Settlement: '↗' };
export function exportCsv(groups: Group[]) {
  const rows = [['Group', 'Date', 'Description', 'Category', 'Type', 'Excluded from stats', 'Member', 'Paid (INR)', 'Consumed (INR)'], ...groups.flatMap(g => g.expenses.flatMap(e => e.splits.map(s => [g.name, e.date, e.description, e.category, e.splitType, String(e.excluded), g.members.find(m => m.id === s.memberId)?.name || s.memberId, (s.paid / 100).toFixed(2), (s.owed / 100).toFixed(2)])))];
  return '\uFEFF' + rows.map(r => r.map(v => '"' + String(v).replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"', '""') + '"').join(',')).join('\r\n');
}

export function groupSplitDefaults(group: Group): SplitDefault {
  const fallback: SplitDefault = { mode: 'EQUAL', participants: group.members.map(m => m.id), values: {} };
  const defaults = group.defaultSplit;
  if (!defaults || !['EQUAL', 'PERCENT', 'SHARES'].includes(defaults.mode) || !defaults.participants.length || new Set(defaults.participants).size !== defaults.participants.length || defaults.participants.some(id => !group.members.some(m => m.id === id))) return fallback;
  try { splitAmounts(10000, defaults.mode, defaults.participants.map(id => defaults.values[id] || (defaults.mode === 'SHARES' ? '1' : '0'))); return defaults; } catch { return fallback; }
}

export function restorableExpense(group: Group, event: Audit): Expense | null {
  if (event.action !== 'Deleted expense' || !event.before || group.expenses.some(e => e.id === event.before!.id)) return null;
  const latest = group.audit.find(a => a.action === 'Deleted expense' && (a.expenseId || a.before?.id) === event.before!.id);
  return latest?.id === event.id ? event.before : null;
}
