import { useState } from 'react';
import { ArrowRight, ArrowUpRight, Check } from 'lucide-react';
import { Field } from './components';
import { cents, localDate, money, uid, type Expense, type Group } from './lib/domain';
export default function SettlementCard({ group, debt, me, save }: { group: Group; debt: { from: string; to: string; amount: number }; me: string; save: (g: Group, e: Expense) => boolean }) {
  const [review, setReview] = useState(false);
  const [amount, setAmount] = useState(() => String(debt.amount / 100));
  const [date, setDate] = useState(localDate);
  const [error, setError] = useState('');
  const from = group.members.find(m => m.id === debt.from)!;
  const to = group.members.find(m => m.id === debt.to)!;
  const participant = from.id === me || to.id === me;
  let transfer = debt.amount; try { transfer = cents(amount); } catch { transfer = 0; }
  return <div className="settlement-card">
    <small>{group.name}</small>
    <div className="row spread">
      <span>
        <strong>{from.id === me ? 'You' : from.name.split(' ')[0]}</strong>
        <ArrowRight size={14} />
        <strong>{to.id === me ? 'you' : to.name.split(' ')[0]}</strong>
      </span>
      <strong>{money(debt.amount)}</strong>
    </div>
    {review ? <form className="form-stack payment-review" onSubmit={e => {
      e.preventDefault(); try {
        const paid = cents(amount); if (!paid || paid > debt.amount) throw new Error(`Enter a payment between ₹0.01 and ${money(debt.amount)}.`);
        if (!participant) throw new Error('Only the payer or recipient can record this payment.');
        save(group, { id: uid(), description: `${from.name.split(' ')[0]} paid ${to.name.split(' ')[0]}`, amount: paid, category: 'Settlement', date, splitType: 'SETTLEMENT', excluded: true, splits: group.members.map(m => ({ memberId: m.id, paid: m.id === from.id ? paid : 0, owed: m.id === to.id ? paid : 0 })) });
      } catch (e) { setError((e as Error).message); }
    }}>
      <div className="form-grid">
        <Field label="Amount paid · INR">
          <input autoFocus inputMode="decimal" required value={amount} onChange={e => setAmount(e.target.value)} />
        </Field>
        <Field label="Payment date">
          <input type="date" required value={date} max={localDate()} onChange={e => setDate(e.target.value)} />
        </Field>
      </div>
      <p className="helper">{transfer > 0 && transfer <= debt.amount ? `${money(debt.amount - transfer)} of this suggested payment will remain. ` : ''}This records money already transferred. faircrumb does not send or verify payments.</p>
      {to.upi && from.id === me && transfer > 0 && transfer <= debt.amount && <a className="button" href={`upi://pay?pa=${encodeURIComponent(to.upi)}&pn=${encodeURIComponent(to.name)}&am=${(transfer / 100).toFixed(2)}&cu=INR`}>Open UPI for {money(transfer)}<ArrowUpRight size={14} />
      </a>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="row">
        <button type="submit" className="button primary grow">Confirm payment <Check size={14} />
        </button>
        <button type="button" className="button" onClick={() => setReview(false)}>Cancel</button>
      </div>
    </form> : <button type="button" className="button primary small-button" disabled={!participant} onClick={() => setReview(true)}>Record payment <ArrowRight size={14} />
    </button>}
  </div>;
}
