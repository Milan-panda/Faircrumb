import { Monitor, Moon, Sun } from 'lucide-react';
import { setTheme, useTheme, type ThemePreference } from './lib/theme';
const choices: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
];
export function ThemeToggle() {
  const { resolved } = useTheme();
  return <button type="button" className="icon-button theme-toggle" onClick={() => setTheme(resolved === 'dark' ? 'light' : 'dark')}
    aria-label={`Switch to ${resolved === 'dark' ? 'light' : 'dark'} mode`} title={`Switch to ${resolved === 'dark' ? 'light' : 'dark'} mode`}>
    <span className="theme-glyphs" data-mode={resolved} aria-hidden="true">
      <Sun className="theme-sun" size={18} />
      <Moon className="theme-moon" size={18} />
    </span>
  </button>;
}
export function ThemeSettings() {
  const { preference, resolved, persistent } = useTheme();
  return <section className="panel settings-panel appearance-panel" aria-labelledby="appearance-heading">
    <div className="row spread">
      <h3 id="appearance-heading">Appearance</h3>
      <span className="appearance-status">{resolved === 'dark' ? 'Evening calm' : 'A little daylight'}</span>
    </div>
    <p className="helper">Choose your light. System follows your device automatically.</p>
    <div className="theme-options" role="group" aria-label="Color theme" data-selected={preference}>
      <span className="theme-selection" aria-hidden="true" />
      {choices.map(({ value, label, icon: Icon }) => <button type="button" key={value} aria-pressed={preference === value} onClick={() => setTheme(value)}>
        <Icon size={16} />{label}</button>)}
    </div>
    <p className="theme-footnote" role="status">{persistent ? 'Remembered on this device, even offline.' : 'Theme changed for this visit. Your browser could not save the preference.'}</p>
  </section>;
}
