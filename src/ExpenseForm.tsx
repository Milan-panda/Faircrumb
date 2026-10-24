import { useEffect, useState, type FormEvent } from 'react';
import { Plus, Minus, Paperclip, X } from 'lucide-react';
import { draftKey, readDraft } from './lib/drafts';
import { Avatar, Field } from './components';
import { categories, cents, groupSplitDefaults, money, localDate, splitAmounts, uid, type Expense, type Group } from './lib/domain';
export default function ExpenseForm({ groups, initialGroup, me, existing, onSave, upload }: {
  groups: Group[];
  initialGroup: string;
  me: string;
  existing?: Expense;
  onSave: (group: Group, e: Expense) => boolean;
  upload?: (group: Group, file: File) => Promise<string>;
}) {
  const [draft] = useState(() => { if (existing) return null; const saved = readDraft(me); return saved && groups.some(g => g.id === saved.groupId) ? saved : null; });
  const [groupId, setGroupId] = useState(draft && groups.some(g => g.id === draft.groupId) ? draft.groupId : initialGroup || groups[0]?.id || '');
  const group = groups.find(g => g.id === groupId)!;
  const defaults = group ? groupSplitDefaults(group) : { mode: 'EQUAL', participants: [], values: {} };
  const [description, setDescription] = useState(existing?.description || draft?.description || '');
  const [amount, setAmount] = useState(existing ? String(existing.amount / 100) : draft?.amount || '');
  const [category, setCategory] = useState(existing?.category || draft?.category || categories[0]);
  const [date, setDate] = useState(existing?.date || draft?.date || localDate());
  const [mode, setMode] = useState(existing?.splitType || draft?.mode || defaults.mode);
  const [excluded, setExcluded] = useState(existing?.excluded || draft?.excluded || false);
  const [selected, setSelected] = useState<string[]>(() => existing ? existing.splits.filter(s => s.owed > 0).map(s => s.memberId) : draft?.selected.filter(id => group.members.some(m => m.id === id)) || defaults.participants);
  const [values, setValues] = useState<Record<string, string>>(() => existing?.splitValues || (!existing ? draft?.values || defaults.values : undefined) || Object.fromEntries(existing?.splits.map(s => [s.memberId, existing.splitType === 'PERCENT' ? String(s.owed / existing.amount * 100) : String(s.owed / 100)]) || []));
  const [payer, setPayer] = useState(existing?.splits.find(s => s.paid > 0)?.memberId || draft?.payer || me);
  const [multi, setMulti] = useState(() => existing ? (existing.splits.filter(s => s.paid > 0).length || 0) > 1 : draft?.multi || false);
  const [paid, setPaid] = useState<Record<string, string>>(() => !existing && draft ? draft.paid : Object.fromEntries(existing?.splits.map(s => [s.memberId, String(s.paid / 100)]) || []));
  const [extra, setExtra] = useState(existing?.extra || draft?.extra || '0');
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState(existing?.receipt || draft?.receipt || '');
  const [uploading, setUploading] = useState(false);
  const [draftSaved, setDraftSaved] = useState(true);
  const [restored, setRestored] = useState(!!draft);
  useEffect(() => {
    if (existing) return;
    try {
      if (description || amount) localStorage.setItem(draftKey(me), JSON.stringify({ groupId, description, amount, category, date, mode, excluded, selected, values, payer, multi, paid, extra, receipt }));
      else localStorage.removeItem(draftKey(me));
      setDraftSaved(true);
    } catch { setDraftSaved(false); }
  }, [existing, me, groupId, description, amount, category, date, mode, excluded, selected, values, payer, multi, paid, extra, receipt]);
  function discardDraft() {
    setDescription(''); setAmount(''); setCategory(categories[0]); setDate(localDate()); setMode(defaults.mode); setExcluded(false); setSelected(defaults.participants); setValues(defaults.values); setPayer(me); setMulti(false); setPaid({}); setExtra('0'); setReceipt(''); setRestored(false);
  }
  if (!group)
    return <p>Create a group first to start sharing expenses.</p>;
  let preview: number[] = [];
  try {
    if (amount)
      preview = splitAmounts(cents(amount), mode, selected.map(id => values[id] || (mode === 'SHARES' ? '1' : '0')), mode === 'ITEMIZED' ? (Number(extra) < 0 ? -cents(extra.slice(1)) : cents(extra)) : 0);
  }
  catch { /* Preview is shown once all values are valid. */ }
  function submit(e: FormEvent) {
    e.preventDefault(); try {
      const total = cents(amount);
      if (!total)
        throw new Error('The bill total must be greater than zero.');
      if (!description.trim())
        throw new Error('Give this expense a description.');
      if (!selected.length)
        throw new Error('Choose at least one participant.');
      const shares = splitAmounts(total, mode, selected.map(id => values[id] || (mode === 'SHARES' ? '1' : '0')), mode === 'ITEMIZED' ? (Number(extra) < 0 ? -cents(extra.slice(1)) : cents(extra)) : 0);
      const payments = multi ? group.members.map(m => cents(paid[m.id] || '0')) : group.members.map(m => m.id === payer ? total : 0);
      if (payments.reduce((a, b) => a + b, 0) !== total)
        throw new Error('Payer amounts must add up to the bill total.');
      const saved = onSave(group, { id: existing?.id || uid(), description: description.trim(), amount: total, category, date, splitType: mode, excluded, splitValues: values, extra, ...(receipt ? { receipt } : {}), splits: group.members.map((m, i) => ({ memberId: m.id, paid: payments[i], owed: shares[selected.indexOf(m.id)] || 0 })) });
      if (!saved) throw new Error(existing ? 'Changes were not saved. Keep this form open and try again.' : 'Expense could not be saved. Your draft is retained.');
      if (saved && !existing) { try { localStorage.removeItem(draftKey(me)); } catch {/* Saved ledger takes priority over draft cleanup. */ } }
    }
    catch (e) {
      setError((e as Error).message);
    }
  }
  return <form onSubmit={submit} className="form-stack">
    {!existing && <div className="draft-status">
      <span role="status">{!draftSaved ? 'Your browser could not save this draft. Keep the form open.' : restored ? `Your saved draft for ${group.name} was restored.` : 'Your draft is saved on this device as you type.'}</span>{(description || amount) && <button type="button" className="text-button" onClick={discardDraft} disabled={uploading}>Discard draft</button>}</div>}
    {!existing && group.defaultSplit && <p className="helper">This group has a saved default split. Adjust any share below for this bill.</p>}
    <div className="form-grid">
      <Field label="Group">
        <select value={groupId} disabled={!!existing} onChange={e => { setGroupId(e.target.value); setReceipt(''); setValues({}); setPaid({}); const next = groups.find(g => g.id === e.target.value)!; const preset = groupSplitDefaults(next); setSelected(preset.participants); setMode(preset.mode); setValues(preset.values); setPayer(next.members.some(m => m.id === me) ? me : next.members[0].id); }}>{groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
      </Field>
      <Field label="Date">
        <input type="date" value={date} required onChange={e => setDate(e.target.value)} />
      </Field>
    </div>
    <Field label="What's it for?">
      <input placeholder="Dinner, a weekend away, the little things…" maxLength={120} autoFocus value={description} required onChange={e => setDescription(e.target.value)} />
    </Field>
    <div className="form-grid">
      <Field label="Total amount · INR">
        <div className="currency-input">
          <span>₹</span>
          <input inputMode="decimal" placeholder="0.00" value={amount} required onChange={e => setAmount(e.target.value)} />
        </div>
      </Field>
      <Field label="Category">
        <select value={category} onChange={e => setCategory(e.target.value)}>{categories.map(c => <option key={c}>{c}</option>)}</select>
      </Field>
    </div>
    <div className="row spread">
      <span className="label">Paid by</span>
      <button type="button" className="text-button" onClick={() => setMulti(!multi)}>{multi ? <Minus size={14} /> : <Plus size={14} />} {multi ? 'Single payer' : 'Multiple payers'}</button>
    </div>{multi ? <div className="split-list">{group.members.map(m => <label className="split-row" key={m.id}>
      <span className="row">
        <Avatar member={m} small />{m.name}</span>
      <input aria-label={`${m.name} paid`} inputMode="decimal" placeholder="0.00" value={paid[m.id] || ''} onChange={e => setPaid({ ...paid, [m.id]: e.target.value })} />
    </label>)}</div> : <select aria-label="Paid by" value={payer} onChange={e => setPayer(e.target.value)}>{group.members.map(m => <option key={m.id} value={m.id}>{m.name}{m.id === me ? ' (you)' : ''}</option>)}</select>}<div className="row spread">
      <span className="label">Split the bill</span>
      <select className="compact-select" aria-label="Split method" value={mode} onChange={e => { setMode(e.target.value); setValues({}); }}>{[['EQUAL', 'Equally'], ['EXACT', 'Exact amounts'], ['PERCENT', 'Percentages'], ['SHARES', 'By shares'], ['ITEMIZED', 'Items + extras']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
    </div>{mode === 'ITEMIZED' && <Field label="Tax + tip + delivery − discount (₹)" hint="Enter each person's item subtotal below. Extras follow the same proportions.">
      <input inputMode="decimal" value={extra} onChange={e => setExtra(e.target.value)} />
    </Field>}<div className="split-list">{group.members.map(m => {
      const index = selected.indexOf(m.id); return <div className="split-row" key={m.id}>
        <label className="row">
          <input type="checkbox" checked={index >= 0} onChange={() => setSelected(index >= 0 ? selected.filter(id => id !== m.id) : [...selected, m.id])} />
          <Avatar member={m} small />{m.name}{m.id === me && <small>you</small>}</label>{index >= 0 && (mode === 'EQUAL' ? <span className="split-value">{preview.length ? money(preview[index]) : '—'}</span> : <div className="row">
            <input aria-label={`${m.name} ${mode === 'PERCENT' ? 'percentage' : 'share'}`} inputMode="decimal" placeholder={mode === 'SHARES' ? '1' : '0'} value={values[m.id] || ''} onChange={e => setValues({ ...values, [m.id]: e.target.value })} />{mode === 'PERCENT' ? '%' : mode === 'SHARES' ? '×' : '₹'}</div>)}</div>;
    })}</div>{preview.length > 0 && mode !== 'EQUAL' && <p className="helper">{selected.map((id, i) => `${group.members.find(m => m.id === id)?.name.split(' ')[0]}: ${money(preview[i])}`).join(' · ')}</p>}<label className="check-label">
      <input type="checkbox" checked={excluded} onChange={e => setExcluded(e.target.checked)} />
      <span>Exclude from spending insights<small>For personal transfers or loans. Balances still count.</small>
      </span>
    </label>
    <div className="receipt-field">
      <span className="label row">
        <Paperclip size={14} /> Receipt (optional)</span>{receipt ? <div className="row spread helper">
          <span>Receipt attached</span>
          <button type="button" className="icon-button" aria-label="Remove receipt" onClick={() => setReceipt('')}>
            <X size={15} />
          </button>
        </div> : <label className="field">
          <input aria-label="Upload receipt" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={!upload || uploading || group.revision === 0} onChange={async (e) => {
            const file = e.target.files?.[0]; if (!file || !upload)
              return; setUploading(true); setError(''); try {
                setReceipt(await upload(group, file));
              }
            catch (e) {
              setError((e as Error).message);
            }
            finally {
              setUploading(false);
            }
          }} />
          <small>{uploading ? 'Uploading receipt…' : !upload ? 'Connect Supabase to attach receipts.' : group.revision === 0 ? 'Let this group sync before attaching a receipt.' : 'JPG, PNG, WebP or PDF · up to 5 MB · requires internet'}</small>
        </label>}</div>{error && <p className="form-error" role="alert">{error}</p>}<button className="button primary full" type="submit" disabled={uploading}>{existing ? 'Save changes' : 'Add expense'} <Plus size={17} />
    </button>
  </form>;
}
