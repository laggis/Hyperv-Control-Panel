import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/Toast';
import { StatusBadge, ProgressBar, Badge, Spinner, EmptyState } from '../components/UI';
import { VMActionBar } from '../components/VMActions';
import { EmergencyResetModal } from '../components/VMActions';
import { BandwidthChart, ISOManager } from '../components/VMMonitor';
import * as api from '../api';
import {
  ArrowLeft, Camera, RotateCcw, Trash2, HardDrive,
  Network, Cpu, MemoryStick, Clock, Loader, RefreshCw, Monitor
} from 'lucide-react';
import { formatDistanceToNow, format, isValid } from 'date-fns';

function SnapshotRow({ snap, vmName, onRestore, onDelete, canOperate }) {
  const [confirmAction, setConfirmAction] = useState(null);
  const [loading, setLoading] = useState(false);

  const doAction = async (fn, label) => {
    setLoading(true);
    try {
      await fn();
      onRestore?.(label);
    } finally {
      setLoading(false);
      setConfirmAction(null);
    }
  };

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800/50 hover:bg-slate-800/10 group">
      <Camera size={13} className="text-blue-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-mono text-slate-200 truncate">{snap.Name}</div>
        <div className="text-xs text-slate-500">
          {(() => {
            if (!snap.CreationTime) return '';
            const dt = new Date(snap.CreationTime);
            return isValid(dt) ? format(dt, 'MMM d, yyyy · HH:mm') : String(snap.CreationTime);
          })()}
          {snap.SizeGB ? ` · ${snap.SizeGB} GB` : ''}
        </div>
      </div>
      <Badge variant="default">{snap.SnapshotType || 'Standard'}</Badge>

      {canOperate && (
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {confirmAction === 'restore' ? (
            <div className="flex items-center gap-1">
              <span className="text-xs text-yellow-400 font-mono">Restore?</span>
              <button onClick={() => doAction(() => api.restoreSnapshot(vmName, snap.Name), `Restored to "${snap.Name}"`)}
                disabled={loading}
                className="text-xs px-2 py-1 bg-yellow-500/10 text-yellow-400 rounded border border-yellow-500/20 hover:bg-yellow-500/20 transition-all">
                {loading ? <Loader size={10} className="animate-spin" /> : 'Yes'}
              </button>
              <button onClick={() => setConfirmAction(null)} className="text-xs px-2 py-1 text-slate-500 hover:text-slate-300">No</button>
            </div>
          ) : confirmAction === 'delete' ? (
            <div className="flex items-center gap-1">
              <span className="text-xs text-red-400 font-mono">Delete?</span>
              <button onClick={() => doAction(() => api.deleteSnapshot(vmName, snap.Name), `Deleted "${snap.Name}"`)}
                disabled={loading}
                className="text-xs px-2 py-1 bg-red-500/10 text-red-400 rounded border border-red-500/20 hover:bg-red-500/20 transition-all">
                {loading ? <Loader size={10} className="animate-spin" /> : 'Yes'}
              </button>
              <button onClick={() => setConfirmAction(null)} className="text-xs px-2 py-1 text-slate-500 hover:text-slate-300">No</button>
            </div>
          ) : (
            <>
              <button onClick={() => setConfirmAction('restore')}
                className="p-1.5 rounded hover:bg-yellow-500/10 text-slate-500 hover:text-yellow-400 transition-all" title="Restore">
                <RotateCcw size={12} />
              </button>
              <button onClick={() => setConfirmAction('delete')}
                className="p-1.5 rounded hover:bg-red-500/10 text-slate-500 hover:text-red-400 transition-all" title="Delete">
                <Trash2 size={12} />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function VMDetailPage() {
  const { name } = useParams();
  const vmName = decodeURIComponent(name);
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const [vm, setVM] = useState(null);
  const [snapshots, setSnapshots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [snapsLoading, setSnapsLoading] = useState(true);
  const [showEmergencyReset, setShowEmergencyReset] = useState(false);
  const canOperate = ['admin', 'operator', 'user'].includes(user?.role);

  const fetchVM = useCallback(async () => {
    try {
      const data = await api.getVM(vmName);
      setVM(data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to load VM');
    } finally {
      setLoading(false);
    }
  }, [vmName]);

  const fetchSnaps = useCallback(async () => {
    setSnapsLoading(true);
    try {
      const data = await api.listSnapshots(vmName);
      setSnapshots(Array.isArray(data) ? data : []);
    } catch { setSnapshots([]); }
    finally { setSnapsLoading(false); }
  }, [vmName]);


  useEffect(() => {
    fetchVM();
    fetchSnaps();
    const iv = setInterval(fetchVM, 8000);
    return () => clearInterval(iv);
  }, [fetchVM, fetchSnaps]);

  if (loading) return (
    <div className="flex items-center justify-center h-64 gap-2 text-slate-500">
      <Spinner /> <span className="font-mono text-sm">Loading VM details...</span>
    </div>
  );

  if (!vm) return (
    <div className="p-6 max-w-5xl mx-auto">
      <ToastContainer toasts={toast.toasts} removeToast={toast.removeToast} />
      <div className="flex items-start gap-4 mb-6">
        <button onClick={() => navigate(-1)}
          className="mt-1 p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-all">
          <ArrowLeft size={16} />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-mono font-semibold text-slate-100">Virtual Machines</h1>
        </div>
      </div>
      <EmptyState title={`VM "${vmName}" not found`} description="The backend could not load this VM, or the name is invalid." />
    </div>
  );

  return (
    <div className="p-6 max-w-5xl mx-auto animate-fade-in">
      <ToastContainer toasts={toast.toasts} removeToast={toast.removeToast} />

      {/* Emergency reset modal — rendered at top level so polling never unmounts it */}
      {showEmergencyReset && (
        <EmergencyResetModal
          vmName={vmName}
          vmState={vm?.State}
          onDone={(msg) => { setShowEmergencyReset(false); toast.success(msg); setTimeout(fetchVM, 2000); }}
          onCancel={() => setShowEmergencyReset(false)}
        />
      )}

      {/* Back + header */}
      <div className="flex items-start gap-4 mb-6">
        <button onClick={() => navigate(-1)}
          className="mt-1 p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-all">
          <ArrowLeft size={16} />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-mono font-semibold text-slate-100">{vm.Name}</h1>
            <StatusBadge state={vm.State} />
            <Badge variant="default">Gen {vm.Generation}</Badge>
            <Badge variant="default">v{vm.Version}</Badge>
          </div>
          <div className="flex items-center gap-4 mt-2">
            <VMActionBar
              vm={vm}
              userRole={user?.role}
              onEmergencyReset={() => setShowEmergencyReset(true)}
              onAction={(type, msg) => {
                type === 'error' ? toast.error(msg) : toast.success(msg);
                if (type !== 'error') {
                  // Fetch immediately, then again at 2s and 5s to catch
                  // the Running/Off transition in the detail view header
                  fetchVM();
                  setTimeout(fetchVM, 2000);
                  setTimeout(fetchVM, 5000);
                }
              }}
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => navigate(`/vms/${encodeURIComponent(vmName)}/hv-console`)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-slate-400
              hover:text-green-300 hover:bg-green-500/10 border border-slate-800 hover:border-green-500/20 transition-all font-mono"
            title="Browser RDP console with settings">
            <Monitor size={11} />
            Browser Console
          </button>
          <button onClick={() => { fetchVM(); fetchSnaps(); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-slate-400
              hover:text-slate-200 hover:bg-slate-800 border border-slate-800 transition-all font-mono">
            <RefreshCw size={11} />
            Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left column: resources */}
        <div className="lg:col-span-2 space-y-4">
          {/* Resources */}
          <div className="bg-[#0f1318] border border-slate-800 rounded-2xl p-4">
            <h2 className="text-xs font-mono text-slate-500 uppercase tracking-wider mb-4">Resources</h2>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="bg-[#151a22] rounded-xl p-3">
                <div className="flex items-center gap-2 mb-2 text-xs text-slate-500 font-mono uppercase">
                  <Cpu size={11} /> CPU
                </div>
                <div className="text-2xl font-mono font-semibold text-slate-100">{vm.CPUUsage || 0}%</div>
                <ProgressBar value={vm.CPUUsage || 0} className="mt-2" />
                <div className="text-[10px] text-slate-600 mt-1 font-mono">{vm.ProcessorCount} vCPU{vm.ProcessorCount !== 1 ? 's' : ''}</div>
              </div>
              <div className="bg-[#151a22] rounded-xl p-3">
                <div className="flex items-center gap-2 mb-2 text-xs text-slate-500 font-mono uppercase">
                  <MemoryStick size={11} /> Memory
                </div>
                <div className="text-2xl font-mono font-semibold text-slate-100">{vm.MemoryAssignedGB || 0} <span className="text-sm text-slate-500">GB</span></div>
                {vm.MemoryDemandGB > 0 && (
                  <ProgressBar value={vm.MemoryDemandGB} max={vm.MemoryAssignedGB} color="purple" className="mt-2" />
                )}
                <div className="text-[10px] text-slate-600 mt-1 font-mono">demand: {vm.MemoryDemandGB || 0} GB</div>
              </div>
            </div>

            {/* Uptime */}
            {vm.State === 'Running' && vm.Uptime && (
              <div className="flex items-center gap-2 text-sm text-slate-400 font-mono">
                <Clock size={13} className="text-blue-400" />
                Uptime: {vm.Uptime.Days > 0 ? `${vm.Uptime.Days}d ` : ''}{vm.Uptime.Hours}h {vm.Uptime.Minutes}m
              </div>
            )}
          </div>

          {/* Disks */}
          {vm.HardDrives?.length > 0 && (
            <div className="bg-[#0f1318] border border-slate-800 rounded-2xl p-4">
              <h2 className="text-xs font-mono text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                <HardDrive size={11} /> Storage ({vm.HardDrives.length} disk{vm.HardDrives.length > 1 ? 's' : ''})
              </h2>
              <div className="space-y-2">
                {vm.HardDrives.map((d, i) => (
                  <div key={i} className="bg-[#151a22] rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-mono text-slate-300 truncate max-w-[70%]" title={d.Path}>
                        {d.Path?.split('\\').pop() || d.Path}
                      </span>
                      <span className="text-xs font-mono text-slate-400">{d.SizeGB} GB</span>
                    </div>
                    {d.SizeGB > 0 && (
                      <ProgressBar value={d.FileSizeGB} max={d.SizeGB} color="blue" />
                    )}
                    <div className="text-[10px] text-slate-600 mt-1 font-mono">
                      {d.ControllerType} · used: {d.FileSizeGB} GB
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Network */}
          {vm.NetworkAdapters?.length > 0 && (
            <div className="bg-[#0f1318] border border-slate-800 rounded-2xl p-4">
              <h2 className="text-xs font-mono text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Network size={11} /> Network Adapters
              </h2>
              <div className="space-y-2">
                {vm.NetworkAdapters.map((n, i) => (
                  <div key={i} className="bg-[#151a22] rounded-lg p-3 flex items-center gap-3">
                    <div className="flex-1">
                      <div className="text-xs font-mono text-slate-200">{n.Name}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">{n.SwitchName || 'No switch'}</div>
                      {n.IPAddresses?.length > 0 && (
                        <div className="text-[10px] text-blue-400 font-mono mt-0.5">{n.IPAddresses.join(', ')}</div>
                      )}
                    </div>
                    <div className="text-[10px] font-mono text-slate-600">{n.MacAddress}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right column: snapshots + ISO + bandwidth */}
        <div className="space-y-4">
          {/* Bandwidth chart */}
          <BandwidthChart vmName={vmName} />

          {/* ISO Manager (admin only) */}
          <ISOManager vmName={vmName} isAdmin={canOperate && user?.role === 'admin'} />

          {/* Snapshots */}
          <div className="bg-[#0f1318] border border-slate-800 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-mono text-slate-400 uppercase tracking-wider">
                <Camera size={11} />
                Snapshots {snapshots.length > 0 && <span className="text-slate-600">({snapshots.length})</span>}
              </div>
              <button onClick={fetchSnaps} className="text-slate-600 hover:text-slate-400 transition-colors">
                <RefreshCw size={11} />
              </button>
            </div>

            {snapsLoading ? (
              <div className="flex items-center justify-center py-8 gap-2 text-slate-600">
                <Spinner size={14} />
              </div>
            ) : snapshots.length === 0 ? (
              <div className="py-8 text-center">
                <Camera size={20} className="text-slate-700 mx-auto mb-2" />
                <div className="text-xs text-slate-600 font-mono">No snapshots</div>
              </div>
            ) : (
              <div>
                {snapshots.map((s, i) => (
                  <SnapshotRow
                    key={i}
                    snap={s}
                    vmName={vmName}
                    canOperate={canOperate}
                    onRestore={(msg) => {
                      toast.success(msg);
                      fetchSnaps();
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
