import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Server, LayoutDashboard, ClipboardList, Users, LogOut, Settings as Cog, ShieldCheck, Bell, UserCheck, Shield } from 'lucide-react';

const navItems = [
  { to: '/',         icon: LayoutDashboard, label: 'Dashboard',        exact: true },
  { to: '/vms',      icon: Server,          label: 'Virtual Machines' },
  { to: '/clients',  icon: UserCheck,       label: 'Clients'          },
  { to: '/logs',     icon: ClipboardList,   label: 'Audit Logs'       },
  { to: '/security', icon: ShieldCheck,     label: 'Security'         },
];

const adminItems = [
  { to: '/alerts',   icon: Bell,   label: 'Alerts'   },
  { to: '/ddos',     icon: Shield, label: 'DDoS Protection' },
  { to: '/users',    icon: Users,  label: 'Users'    },
  { to: '/settings', icon: Cog,    label: 'Settings' },
];

export default function Layout({ children }) {
  const { user, logout, isAdmin } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="flex min-h-screen bg-[var(--bg)] text-[var(--text)]">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 bg-[var(--bg2)] border-r border-[var(--border)] flex flex-col">
        {/* Logo */}
        <div className="px-5 py-5 border-b border-[var(--border)]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[rgba(0,212,255,0.08)] border border-[rgba(0,212,255,0.4)] flex items-center justify-center">
              <Server size={14} className="text-[var(--accent)]" />
            </div>
            <div>
              <div className="text-sm font-semibold text-[var(--text-bright)] leading-tight font-[var(--condensed)] tracking-[0.2em] uppercase">
                Hyper-V
              </div>
              <div className="text-[10px] text-[var(--text-dim)] font-mono">CONTROL PANEL</div>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {navItems.map(({ to, icon: Icon, label, exact }) => (
            <NavLink
              key={to}
              to={to}
              end={exact}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all group border border-transparent
                ${isActive
                  ? 'text-[var(--accent)] bg-[rgba(0,212,255,0.06)] border-[color:var(--accent)]'
                  : 'text-[var(--text-dim)] hover:text-[var(--text-bright)] hover:bg-[rgba(255,255,255,0.02)] hover:border-[color:var(--border)]'}`
              }
            >
              <Icon size={15} />
              <span className="font-sans tracking-[0.12em] uppercase text-[11px]">
                {label}
              </span>
            </NavLink>
          ))}

          {isAdmin && (
            <>
              <div className="pt-4 pb-1 px-3">
                <span className="text-[10px] font-mono text-[var(--text-dim)] uppercase tracking-[0.25em]">
                  Admin
                </span>
              </div>
              {adminItems.map(({ to, icon: Icon, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all border border-transparent
                    ${isActive
                      ? 'text-[var(--accent)] bg-[rgba(0,212,255,0.06)] border-[color:var(--accent)]'
                      : 'text-[var(--text-dim)] hover:text-[var(--text-bright)] hover:bg-[rgba(255,255,255,0.02)] hover:border-[color:var(--border)]'}`
                  }
                >
                  <Icon size={15} />
                  <span>{label}</span>
                </NavLink>
              ))}
            </>
          )}
        </nav>

        {/* User section */}
        <div className="px-3 py-4 border-t border-[var(--border)]">
          <div className="flex items-center gap-3 px-3 py-2 mb-1">
            <div className="w-6 h-6 rounded-full bg-[rgba(0,212,255,0.18)] flex items-center justify-center text-[11px] font-bold text-[var(--bg)] uppercase">
              {user?.username?.[0]}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-[var(--text-bright)] truncate">
                {user?.username}
              </div>
              <div className="text-[10px] text-[var(--text-dim)] font-mono capitalize">
                {user?.role}
              </div>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-[var(--text-dim)]
              hover:text-[var(--danger)] hover:bg-[rgba(255,59,92,0.08)] transition-all"
          >
            <LogOut size={14} />
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto grid-bg">
        {children}
      </main>
    </div>
  );
}
