import { clsx } from 'clsx';

// Hyper-V reports State as both strings and integers depending on API version
// Numeric values: 2=Running, 3=Off, 6=Saved, 9=Paused, 10=Starting, 32768=Stopping
const NUMERIC_STATES = { 2: 'Running', 3: 'Off', 6: 'Saved', 9: 'Paused', 10: 'Starting', 32768: 'Stopping', 32769: 'Saving', 32770: 'Stopping' };

const STATE_CONFIG = {
  Running:  { dot: 'bg-green-400',         text: 'text-green-400',  bg: 'bg-green-500/10 border-green-500/20',   label: 'Running'  },
  Off:      { dot: 'bg-red-400',            text: 'text-red-400',    bg: 'bg-red-500/10 border-red-500/20',       label: 'Off'      },
  Paused:   { dot: 'bg-yellow-400',         text: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/20', label: 'Paused'   },
  Saved:    { dot: 'bg-blue-400',           text: 'text-blue-400',   bg: 'bg-blue-500/10 border-blue-500/20',     label: 'Saved'    },
  Starting: { dot: 'bg-cyan-400 animate-pulse', text: 'text-cyan-400',  bg: 'bg-cyan-500/10 border-cyan-500/20',  label: 'Starting' },
  Stopping: { dot: 'bg-orange-400 animate-pulse', text: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/20', label: 'Stopping' },
};

export function StatusBadge({ state, className }) {
  const resolved = NUMERIC_STATES[state] || state;
  const cfg = STATE_CONFIG[resolved] || { dot: 'bg-slate-400', text: 'text-slate-400', bg: 'bg-slate-500/10 border-slate-500/20', label: String(resolved || 'Unknown') };
  return (
    <span className={clsx('inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs font-mono', cfg.bg, cfg.text, className)}>
      <span className={clsx('w-1.5 h-1.5 rounded-full', cfg.dot)} />
      {cfg.label}
    </span>
  );
}

export function StatCard({ label, value, sub, icon: Icon, accent = false }) {
  return (
    <div className={clsx(
      'bg-[var(--bg2)] border rounded-xl p-4 transition-all',
      accent ? 'border-[color:var(--accent)] shadow-[0_0_20px_rgba(0,212,255,0.15)]' : 'border-[color:var(--border)]'
    )}>
      <div className="flex items-start justify-between mb-3">
        <span className="text-xs font-mono text-[var(--text-dim)] uppercase tracking-[0.2em]">{label}</span>
        {Icon && (
          <Icon
            size={14}
            className={accent ? 'text-[var(--accent)]' : 'text-[var(--text-dim)]'}
          />
        )}
      </div>
      <div className="text-2xl font-semibold text-[var(--text-bright)] font-mono">{value}</div>
      {sub && <div className="text-xs text-[var(--text-dim)] mt-1">{sub}</div>}
    </div>
  );
}

export function ProgressBar({ value, max = 100, color = 'blue', label, subLabel }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const colorMap = {
    blue: 'bg-blue-500',
    green: 'bg-green-500',
    yellow: 'bg-yellow-500',
    red: 'bg-red-500',
    purple: 'bg-purple-500',
  };
  const barColor = pct > 85 ? 'bg-red-500' : pct > 60 ? 'bg-yellow-500' : colorMap[color];

  return (
    <div>
      {(label || subLabel) && (
        <div className="flex justify-between mb-1">
          {label && <span className="text-xs text-slate-400">{label}</span>}
          {subLabel && <span className="text-xs font-mono text-slate-500">{subLabel}</span>}
        </div>
      )}
      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div
          className={clsx('h-full rounded-full transition-all duration-700', barColor)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function SectionHeader({ title, subtitle, actions }) {
  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Badge({ children, variant = 'default' }) {
  const variants = {
    default: 'bg-slate-800 text-slate-400',
    blue: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
    green: 'bg-green-500/10 text-green-400 border border-green-500/20',
    red: 'bg-red-500/10 text-red-400 border border-red-500/20',
    yellow: 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20',
    admin: 'bg-purple-500/10 text-purple-400 border border-purple-500/20',
    operator: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
    viewer: 'bg-slate-700 text-slate-400',
  };
  return (
    <span className={clsx('inline-block text-xs font-mono px-2 py-0.5 rounded-md', variants[variant] || variants.default)}>
      {children}
    </span>
  );
}

export function Spinner({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin text-blue-400">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" strokeOpacity="0.2" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function EmptyState({ icon: Icon, title, description }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      {Icon && <Icon size={32} className="text-slate-700 mb-3" />}
      <div className="text-slate-400 font-medium">{title}</div>
      {description && <div className="text-sm text-slate-600 mt-1">{description}</div>}
    </div>
  );
}
