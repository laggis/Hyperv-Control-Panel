import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useVMs } from '../hooks/useVMs';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/Toast';
import { StatCard, StatusBadge, ProgressBar, Spinner, EmptyState } from '../components/UI';
import { VMActionBar } from '../components/VMActions';
import { Server, Activity, RefreshCw, Cpu, MemoryStick, Clock, AlertTriangle, Calendar, Database, Wifi, ShieldCheck } from 'lucide-react';
import { formatDistanceToNow, differenceInDays, format } from 'date-fns';
import * as api from '../api';

function formatUptime(uptimeObj) {
  if (!uptimeObj) return '—';
  const { Days = 0, Hours = 0, Minutes = 0 } = uptimeObj;
  if (Days > 0) return `${Days}d ${Hours}h`;
  if (Hours > 0) return `${Hours}h ${Minutes}m`;
  return `${Minutes}m`;
}

export default function DashboardPage() {
  const { vms, loading, error, lastUpdated, refresh } = useVMs(10000);
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [renewals, setRenewals] = useState([]);
  const [health, setHealth] = useState(null);

  useEffect(() => {
    if (user?.role === 'admin') {
      api.getUpcomingRenewals(14).then(setRenewals).catch(() => {});
    }
  }, [user]);

  useEffect(() => {
    let alive = true;
    const loadHealth = async () => {
      try {
        const data = await api.getHealth();
        if (alive) setHealth(data);
      } catch {
        if (alive) setHealth(null);
      }
    };
    loadHealth();
    const iv = setInterval(loadHealth, 15000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  const running   = vms.filter(v => v.State === 'Running').length;
  const stopped   = vms.filter(v => v.State === 'Off').length;
  const avgCpu    = vms.length ? Math.round(vms.reduce((a, v) => a + (v.CPUUsage || 0), 0) / vms.length) : 0;
  const totalRam  = vms.reduce((a, v) => a + (v.MemoryAssignedGB || 0), 0).toFixed(1);
  const backendUp = health?.status === 'ok';
  const dbLatency = health?.database?.latency_ms;
  const wsCount = health?.sessions?.total ?? 0;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <ToastContainer toasts={toast.toasts} removeToast={toast.removeToast} />

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-0.5 font-mono">
            {lastUpdated
              ? `Updated ${formatDistanceToNow(lastUpdated, { addSuffix: true })}`
              : loading ? 'Loading...' : 'Ready'}
          </p>
        </div>
        <button onClick={refresh} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm
          text-slate-400 hover:text-slate-200 hover:bg-slate-800 border border-slate-800 transition-all">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        <StatCard label="Total VMs" value={vms.length} icon={Server} />
        <StatCard label="Running" value={running} icon={Activity} accent />
        <StatCard label="Stopped" value={stopped} icon={Server} />
        <StatCard label="Avg CPU" value={`${avgCpu}%`} icon={Cpu} />
        <StatCard label="RAM Used" value={`${totalRam} GB`} icon={MemoryStick} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        <div className="bg-[#0f1318] border border-slate-800 rounded-2xl px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="text-[11px] uppercase tracking-wider text-slate-500 font-mono">Backend</div>
            <ShieldCheck size={13} className={backendUp ? 'text-green-400' : 'text-red-400'} />
          </div>
          <div className={`mt-2 text-sm font-mono ${backendUp ? 'text-green-300' : 'text-red-300'}`}>{backendUp ? 'Online' : 'Degraded'}</div>
          <div className="text-[10px] text-slate-600 mt-1">Health endpoint + runtime status</div>
        </div>
        <div className="bg-[#0f1318] border border-slate-800 rounded-2xl px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="text-[11px] uppercase tracking-wider text-slate-500 font-mono">Database</div>
            <Database size={13} className={dbLatency !== null && dbLatency < 250 ? 'text-green-400' : 'text-yellow-400'} />
          </div>
          <div className="mt-2 text-sm font-mono text-slate-200">{dbLatency !== null && dbLatency !== undefined ? `${dbLatency} ms` : 'N/A'}</div>
          <div className="text-[10px] text-slate-600 mt-1">Current ping latency</div>
        </div>
        <div className="bg-[#0f1318] border border-slate-800 rounded-2xl px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="text-[11px] uppercase tracking-wider text-slate-500 font-mono">WebSocket Sessions</div>
            <Wifi size={13} className={wsCount > 0 ? 'text-blue-400' : 'text-slate-500'} />
          </div>
          <div className="mt-2 text-sm font-mono text-slate-200">{wsCount}</div>
          <div className="text-[10px] text-slate-600 mt-1">Active console sessions</div>
        </div>
      </div>

      {/* Renewal reminders (admin only) */}
      {renewals.length > 0 && (
        <div className="mb-6 bg-yellow-500/8 border border-yellow-500/20 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={14} className="text-yellow-400" />
            <span className="text-sm font-medium text-yellow-300">
              {renewals.length} client renewal{renewals.length !== 1 ? 's' : ''} coming up
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {renewals.map(r => (
              <div key={r.id}
                onClick={() => navigate('/clients')}
                className="flex items-center gap-2.5 bg-[#0f1318] border border-slate-800 rounded-xl px-3 py-2.5 cursor-pointer hover:border-yellow-500/20 transition-all">
                <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-mono text-slate-200 truncate font-medium">{r.name}</div>
                  <div className="text-[10px] font-mono text-slate-500">
                    {r.days_until === 0 ? 'Renews today' : `Renews in ${r.days_until} day${r.days_until !== 1 ? 's' : ''}`}
                    {r.renewal_amount ? ` · ${parseFloat(r.renewal_amount).toLocaleString()} kr` : ''}
                  </div>
                </div>
                <Calendar size={11} className="text-yellow-500/60 shrink-0" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* VM Table */}
      <div className="bg-[#0f1318] border border-slate-800 rounded-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
          <span className="text-sm font-medium text-slate-300">Virtual Machines</span>
          <div className="flex items-center gap-2 text-xs text-slate-500 font-mono">
            <span className={`w-1.5 h-1.5 rounded-full inline-block ${loading ? 'bg-yellow-400 animate-pulse' : 'bg-green-400'}`} />
            {loading ? 'Loading' : 'Live'}
          </div>
        </div>

        {loading && vms.length === 0 ? (
          <div className="flex items-center justify-center py-16 gap-2 text-slate-500">
            <Spinner />
            <span className="text-sm font-mono">Loading assigned VMs...</span>
          </div>
        ) : error ? (
          <div className="py-16 text-center">
            <div className="text-red-400 text-sm font-mono">{error}</div>
            <p className="text-slate-600 text-xs mt-1">Ensure the backend is running and has Hyper-V access</p>
          </div>
        ) : vms.length === 0 ? (
          <EmptyState icon={Server} title="No VMs found" description="No virtual machines were detected on this host" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] font-mono text-slate-600 uppercase tracking-wider border-b border-slate-800">
                  <th className="text-left px-5 py-2.5">Name</th>
                  <th className="text-left px-4 py-2.5">State</th>
                  <th className="text-left px-4 py-2.5">CPU</th>
                  <th className="text-left px-4 py-2.5">Memory</th>
                  <th className="text-left px-4 py-2.5">Uptime</th>
                  <th className="text-left px-4 py-2.5">Actions</th>
                </tr>
              </thead>
              <tbody>
                {vms.map((vm) => {
                  return (
                    <tr key={vm.Name} className="border-b border-slate-800/50 hover:bg-slate-800/20 transition-colors">
                      <td className="px-5 py-3">
                        <button
                          onClick={() => navigate(`/vms/${encodeURIComponent(vm.Name)}`)}
                          className="font-mono text-slate-200 hover:text-blue-400 transition-colors text-left"
                        >
                          {vm.Name}
                        </button>
                        {vm.Version && (
                          <div className="text-[10px] text-slate-600 font-mono">Gen {vm.Generation} · v{vm.Version}</div>
                        )}
                      </td>

                      <td className="px-4 py-3">
                        <StatusBadge state={vm.State} />
                      </td>
                      <td className="px-4 py-3 w-28">
                        <div className="flex items-center gap-2">
                          <div className="flex-1">
                            <ProgressBar value={vm.CPUUsage || 0} color="blue" />
                          </div>
                          <span className="text-xs font-mono text-slate-400 w-8 text-right">
                            {vm.CPUUsage || 0}%
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-slate-300 font-mono text-xs">
                          {vm.MemoryAssignedGB ? `${vm.MemoryAssignedGB} GB` : '—'}
                        </div>
                        {vm.MemoryDemandGB > 0 && (
                          <div className="text-[10px] text-slate-600 font-mono">demand: {vm.MemoryDemandGB} GB</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs font-mono text-slate-400 flex items-center gap-1">
                          <Clock size={10} />
                          {vm.State === 'Running' ? formatUptime(vm.Uptime) : '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <VMActionBar
                          vm={vm}
                          userRole={user?.role}
                          onAction={(type, msg) => {
                            type === 'error' ? toast.error(msg) : toast.success(msg);
                            if (type !== 'error') refresh();
                          }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
