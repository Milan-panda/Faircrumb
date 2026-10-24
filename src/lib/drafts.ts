export type ExpenseDraft = { groupId: string; description: string; amount: string; category: string; date: string; mode: string; excluded: boolean; selected: string[]; values: Record<string, string>; payer: string; multi: boolean; paid: Record<string, string>; extra: string; receipt: string };
// Compatibility key: renaming the product must not discard an unfinished expense.
export const draftKey = (owner: string) => `splitfree-expense-draft-${owner}`;
export function readDraft(owner: string): ExpenseDraft | null {
  try {
    const value = JSON.parse(localStorage.getItem(draftKey(owner)) || 'null');
    if (!value || ['groupId', 'description', 'amount', 'category', 'date', 'mode', 'payer', 'extra', 'receipt'].some(key => typeof value[key] !== 'string') || !Array.isArray(value.selected) || value.selected.some((id: unknown) => typeof id !== 'string') || typeof value.excluded !== 'boolean' || typeof value.multi !== 'boolean') return null;
    for (const key of ['values', 'paid']) if (!value[key] || Array.isArray(value[key]) || typeof value[key] !== 'object' || Object.values(value[key]).some(v => typeof v !== 'string')) return null;
    if (!['EQUAL', 'EXACT', 'PERCENT', 'SHARES', 'ITEMIZED'].includes(value.mode)) return null;
    return value;
  } catch { return null; }
}
