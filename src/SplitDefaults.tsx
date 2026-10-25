import { useState } from 'react';
import { Check } from 'lucide-react';
import { Avatar, Field } from './components';
import { groupSplitDefaults, splitAmounts, type Group, type SplitDefault } from './lib/domain';
export default function SplitDefaults({ group, save }: { group: Group; save: (value: SplitDefault) => void }) {
  const [defaults, setDefaults] = useState(() => groupSplitDefaults(group));
  const [error, setError] = useState('');
  return <form className="form-stack" onSubmit={e => {
    e.preventDefault(); try {
      if (!defaults.participants.length) throw new Error('Choose at least one person.');
      const weights = defaults.participants.map(id => defaults.values[id] || (defaults.mode === 'SHARES' ? '1' : '0'));
      if (defaults.mode !== 'EQUAL' && weights.some(value => !/^\d{1,7}(\.\d{1,4})?$/.test(value) || Number(value) > 1000000)) throw new Error('Use valid weights up to 1,000,000 with at most four decimal places.');
      splitAmounts(10000, defaults.mode, weights); save(defaults);
    } catch (e) { setError((e as Error).message); }
  }}>
    <p className="modal-intro">Set your usual split once. It applies to new expenses for everyone in this group. Existing bills keep their original shares.</p>
    <Field label="Default method">
      <select value={defaults.mode} onChange={e => setDefaults({ ...defaults, mode: e.target.value as SplitDefault['mode'], values: {} })}>
        <option value="EQUAL">Equal shares</option>
        <option value="PERCENT">Percentages</option>
        <option value="SHARES">By shares</option>
      </select>
    </Field>
    <div className="split-list">{group.members.map(m => {
      const checked = defaults.participants.includes(m.id); return <div className="split-row" key={m.id}>
        <label className="row">
          <input type="checkbox" checked={checked} onChange={() => setDefaults({ ...defaults, participants: checked ? defaults.participants.filter(id => id !== m.id) : [...defaults.participants, m.id] })} />
          <Avatar member={m} small />{m.name}</label>{checked && defaults.mode !== 'EQUAL' && <span className="row">
            <input inputMode="decimal" aria-label={`${m.name} default ${defaults.mode === 'PERCENT' ? 'percentage' : 'shares'}`} placeholder={defaults.mode === 'SHARES' ? '1' : '0'} value={defaults.values[m.id] || ''} onChange={e => setDefaults({ ...defaults, values: { ...defaults.values, [m.id]: e.target.value } })} />{defaults.mode === 'PERCENT' ? '%' : '×'}</span>}</div>;
    })}</div>
    <p className="helper">You can adjust every individual bill. If someone new joins, update these defaults to include them.</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button type="submit" className="button primary full">Save default split <Check size={16} />
    </button>
  </form>;
}
