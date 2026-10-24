import { describe, it, expect } from 'vitest';
import { allocate, balances, cents, debts, exportCsv, lensAmount, splitAmounts, type Group } from '../src/lib/domain';
const group: Group = { id: 'g', name: 'Trip', category: 'trip', currency: 'INR', revision: 0, audit: [], members: [{ id: 'a', name: 'A', username: 'aaa' }, { id: 'b', name: 'B', username: 'bbb' }, { id: 'c', name: 'C', username: 'ccc' }], expenses: [{ id: 'e', description: 'Dinner', date: '2026-10-24', amount: 10000, category: 'Food & drinks', splitType: 'EQUAL', excluded: false, splits: [{ memberId: 'a', paid: 10000, owed: 3334 }, { memberId: 'b', paid: 0, owed: 3333 }, { memberId: 'c', paid: 0, owed: 3333 }] }] };
describe('exact money arithmetic', () => {
  it('parses decimal text without rounding floating point input', () => { expect(cents('10.01')).toBe(1001); expect(() => cents('1.001')).toThrow(); expect(() => cents('-2')).toThrow(); });
  it('preserves every paise in uneven splits', () => {
    expect(allocate(10000, [1, 1, 1])).toEqual([3334, 3333, 3333]); for (let n = 1; n < 30; n++) {
      const out = allocate(10001, Array.from({ length: n }, (_, i) => i + 1));
      expect(out.reduce((a, b) => a + b, 0)).toBe(10001);
    }
  });
  it('validates exact and percentage totals', () => { expect(() => splitAmounts(10000, 'EXACT', ['30', '30'])).toThrow(); expect(() => splitAmounts(10000, 'PERCENT', ['50', '49'])).toThrow(); expect(splitAmounts(10000, 'PERCENT', ['25', '75'])).toEqual([2500, 7500]); });
  it('allocates extras and discounts proportionally', () => { expect(splitAmounts(12000, 'ITEMIZED', ['25', '75'], 2000)).toEqual([3000, 9000]); expect(splitAmounts(8000, 'ITEMIZED', ['25', '75'], -2000)).toEqual([2000, 6000]); expect(() => splitAmounts(12000, 'ITEMIZED', ['25', '70'], 2000)).toThrow(); });
  it('rejects negative, empty and invalid shares', () => { expect(() => allocate(100, [])).toThrow(); expect(() => allocate(100, [0, 0])).toThrow(); expect(() => splitAmounts(100, 'SHARES', ['NaN', '1'])).toThrow(); });
});
describe('debt accounting', () => {
  it('keeps group balances zero-sum and clears them with settlements', () => {
    const net = balances(group); expect(Object.values(net).reduce((a, b) => a + b, 0)).toBe(0); const transfers = debts(group); expect(transfers).toHaveLength(2); for (const t of transfers) {
      net[t.from] += t.amount;
      net[t.to] -= t.amount;
    } expect(Object.values(net)).toEqual([0, 0, 0]);
  });
  it('settlements reduce debt without inflating consumption', () => { const settlement = { ...group.expenses[0], id: 's', amount: 3333, splitType: 'SETTLEMENT', excluded: true, splits: [{ memberId: 'a', paid: 0, owed: 3333 }, { memberId: 'b', paid: 3333, owed: 0 }, { memberId: 'c', paid: 0, owed: 0 }] }; const next = { ...group, expenses: [...group.expenses, settlement] }; expect(balances(next).b).toBe(0); expect(lensAmount(settlement, 'consumption', 'b')).toBe(0); expect(lensAmount(settlement, 'cash', 'b')).toBe(3333); expect(lensAmount(settlement, 'group', 'b')).toBe(0); });
  it('excludes loans from true spend but retains cash flow', () => { const e = { ...group.expenses[0], excluded: true }; expect(lensAmount(e, 'consumption', 'a')).toBe(0); expect(lensAmount(e, 'cash', 'a')).toBe(10000); });
  it('quotes CSV cells and neutralizes formula injection', () => { const csv = exportCsv([{ ...group, name: '=HYPERLINK("bad")' }]); expect(csv).toContain("'=HYPERLINK"); expect(csv).toContain('33.34'); });
});

describe('group default and recovery rules', () => {
  it('does not retroactively change historical shares when defaults change', async () => {
    const { groupSplitDefaults } = await import('../src/lib/domain');
    const customized = { ...group, defaultSplit: { mode: 'PERCENT' as const, participants: ['a', 'b'], values: { a: '60', b: '40' } } };
    expect(groupSplitDefaults(customized).mode).toBe('PERCENT');
    expect(customized.expenses[0].splits[0].owed).toBe(3334);
    expect(groupSplitDefaults({ ...customized, defaultSplit: { ...customized.defaultSplit, values: { a: '99', b: '99' } } }).mode).toBe('EQUAL');
  });
  it('only restores the most recent deleted version once', async () => {
    const { restorableExpense } = await import('../src/lib/domain');
    const before = group.expenses[0];
    const old = { id: 'old', action: 'Deleted expense', at: '2026-10-23', actor: 'A', description: 'Dinner', expenseId: before.id, before: { ...before, amount: 5000 } };
    const recent = { ...old, id: 'recent', at: '2026-10-24', before };
    const deleted = { ...group, expenses: [], audit: [recent, old] };
    expect(restorableExpense(deleted, old)).toBeNull();
    expect(restorableExpense(deleted, recent)).toEqual(before);
    expect(restorableExpense({ ...deleted, expenses: [before] }, recent)).toBeNull();
  });
});
