import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { X, ArrowUpRight } from 'lucide-react';
import { money, type Member } from './lib/domain';
export function Modal({ title, children, close, wide = false }: {
  title: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const heading = useId();
  const [closing, setClosing] = useState(false);
  const onClose = useRef(close);
  useEffect(() => { onClose.current = close; }, [close]);
  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(() => onClose.current(), 170);
    return () => clearTimeout(timer);
  }, [closing]);
  function requestClose() {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) onClose.current();
    else setClosing(true);
  }
  useEffect(() => { const element = ref.current; const previous = document.activeElement as HTMLElement | null; element?.showModal(); return () => { element?.close(); previous?.focus(); }; }, []);
  return <dialog ref={ref} className={wide ? 'modal wide' : 'modal'} aria-labelledby={heading} data-closing={closing || undefined} onCancel={event => { event.preventDefault(); requestClose(); }} onClick={e => {
    if (e.target !== e.currentTarget) return;
    const bounds = e.currentTarget.getBoundingClientRect();
    if (e.clientX < bounds.left || e.clientX > bounds.right || e.clientY < bounds.top || e.clientY > bounds.bottom) requestClose();
  }}>
    <div className="modal-head">
      <h2 id={heading}>{title}</h2>
      <button type="button" className="icon-button" aria-label="Close dialog" onClick={requestClose}>
        <X size={20} />
      </button>
    </div>{children}</dialog>;
}
export function Avatar({ member, small = false }: {
  member: Member;
  small?: boolean;
}) { const hue = [...member.name].reduce((a, b) => a + b.charCodeAt(0), 0) % 4; return <span className={`avatar tone-${hue} ${small ? 'small' : ''}`} title={member.name}>{member.name.split(' ').map(n => n[0]).slice(0, 2).join('')}</span>; }
export function Amount({ value }: {
  value: number;
}) {
  return <span className={value > 0 ? 'positive' : value < 0 ? 'negative' : 'muted'}>{money(Math.abs(value))}<small>{value > 0 ? 'you get back' : value < 0 ? 'you owe' : 'all settled up'}</small>
  </span>;
}
export function Empty({ title, detail, action }: {
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return <div className="empty">
    <span className="empty-icon">
      <ArrowUpRight size={30} />
    </span>
    <h3>{title}</h3>
    <p>{detail}</p>{action}</div>;
}
export function Field({ label, children, hint }: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return <label className="field">
    <span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}
