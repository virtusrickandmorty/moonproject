/** Light, Dark or Same as the device, for this browser's ERP screens (theme.ts), in the person's menu. */
import { setThemeChoice, useThemeChoice, type ThemeChoice } from '../theme.ts';

const CHOICES: [ThemeChoice, string][] = [['device', 'Same as device'], ['light', 'Light'], ['dark', 'Dark']];

export function ThemePicker({ className = '' }: { className?: string }) {
  const choice = useThemeChoice();
  return (
    <div role="radiogroup" aria-label="Screen colours" className={`flex gap-1 ${className}`}>
      {CHOICES.map(([value, label]) => (
        <button key={value} type="button" role="radio" aria-checked={choice === value} onClick={() => setThemeChoice(value)}
          className={`flex-1 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-semibold ring-1 ${choice === value ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'}`}>
          {label}
        </button>
      ))}
    </div>
  );
}
