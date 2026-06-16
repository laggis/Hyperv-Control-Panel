import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useVMs } from '../hooks/useVMs';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/Toast';
import { StatusBadge, ProgressBar, Spinner, EmptyState } from '../components/UI';
import { VMActionBar } from '../components/VMActions';
import { Server, RefreshCw, Search, ChevronRight, X, Plus, Trash2, FolderPlus, Loader } from 'lucide-react';
import { getVmRoots, addVmRoot, deleteVmRoot, deleteVM } from '../api';
import CreateVMWizard from '../components/CreateVMWizard';

function ManageRootsModal({ onClose, onChanged }) {
  const [envRoots, setEnvRoots] = useState([]);
  const [dbRoots, setDbRoots] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const r = await getVmRoots();
    setEnvRoots(r.env || []);
    setDbRoots(r.db || []);
  };

  useEffect(() => { load(); }, []);

  const handleAdd = async () => {
    const path = input.trim();
    if (!path) return;
    setBusy(true);
    try {
      await addVmRoot(path);
      setInput('');
      await load();
      onChanged && onChanged();
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id) => {
    setBusy(true);
    try {
      await deleteVmRoot(id);
      await load();
      onChanged && onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#151a22] border border-slate-700 rounded-2xl p-5 w-full max-w-lg shadow-2xl animate-slide-up mx-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <FolderPlus size={16} className="text-blue-400" />
            <h3 className="font-semibold text-slate-100 text-sm">Manage VM Roots</h3>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300"><X size={16} /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-mono text-slate-400 mb-1 uppercase">Add root path</label>
            <div className="flex gap-2">
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } }}
                placeholder="E.g. E:\VMStore"
                className="flex-1 bg-[#0f1318] border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 font-mono focus:outline-none focus:border-blue-500/60"
              />
              <button
                onClick={handleAdd}
                disabled={busy}
                className="px-3 py-2 rounded-lg text-sm bg-blue-600 hover:bg-blue-500 text-white transition-all disabled:opacity-60 flex items-center gap-1.5"
              >
                <Plus size={12} /> Add
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="border border-slate-800 rounded-xl p-3">
              <div className="text-xs font-mono text-slate-500 uppercase mb-2">Env roots</div>
              <div className="space-y-2">
                {envRoots.length === 0 && <div className="text-xs text-slate-600 font-mono">None</div>}
                {envRoots.map((p, i) => (
                  <div key={i} className="flex items-center justify-between bg-[#0f1318] border border-slate-800 rounded-lg px-3 py-2">
                    <span className="text-xs font-mono text-slate-300 truncate" title={p}>{p}</span>
                    <span className="text-[10px] text-slate-500 font-mono">env</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="border border-slate-800 rounded-xl p-3">
              <div className="text-xs font-mono text-slate-500 uppercase mb-2">Custom roots</div>
              <div className="space-y-2">
                {dbRoots.length === 0 && <div className="text-xs text-slate-600 font-mono">None</div>}
                {dbRoots.map((r) => (
                  <div key={r.id} className="flex items-center justify-between bg-[#0f1318] border border-slate-800 rounded-lg px-3 py-2">
                    <span className="text-xs font-mono text-slate-300 truncate" title={r.path}>{r.path}</span>
                    <button
                      onClick={() => handleDelete(r.id)}
                      disabled={busy}
                      className="p-1.5 rounded text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-60"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function VMsPage() {
  const { vms, loading, error, refresh } = useVMs(15000);
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [showRoots, setShowRoots] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [deletingVM, setDeletingVM] = useState(null);

  const filtered = vms.filter(v => v.Name?.toLowerCase().includes(search.toLowerCase()));

  const handleDeleteVM = async (vm) => {
    if (!window.confirm(`Delete VM "${vm.Name}"? This cannot be undone.\n\nClick OK to delete (VHD files will be kept).`)) return;
    setDeletingVM(vm.Name);
    try {
      await deleteVM(vm.Name, false);
      toast.success(`VM "${vm.Name}" deleted`);
      setTimeout(refresh, 1000);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Delete failed');
    } finally {
      setDeletingVM(null);
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <ToastContainer toasts={toast.toasts} removeToast={toast.removeToast} />
      {showRoots && (
        <ManageRootsModal
          onClose={() => setShowRoots(false)}
          onChanged={() => setTimeout(refresh, 500)}
        />
      )}
      {showWizard && (
        <CreateVMWizard
          onDone={(msg) => { toast.success(msg); setShowWizard(false); setTimeout(refresh, 2000); }}
          onCancel={() => setShowWizard(false)}
        />
      )}

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Virtual Machines</h1>
          <p className="text-sm text-slate-500 mt-0.5">{vms.length} VM{vms.length !== 1 ? 's' : ''} on this host</p>
        </div>
        <div className="flex items-center gap-2">
          {user?.role === 'admin' && (
            <>
              <button
                onClick={() => setShowWizard(true)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-white
                  bg-blue-600 hover:bg-blue-500 transition-all btn-glow"
              >
                <Plus size={13} />
                Create VM
              </button>
              <button
                onClick={() => setShowRoots(true)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-300 hover:text-white
                  bg-slate-800/60 border border-slate-700 transition-all"
              >
                <FolderPlus size={13} />
                Roots
              </button>
            </>
          )}
          <div className="relative">
            <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              placeholder="Search VMs..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="bg-[#0f1318] border border-slate-800 rounded-lg pl-8 pr-3 py-2 text-sm text-slate-300
                placeholder:text-slate-600 focus:outline-none focus:border-slate-700 w-44 font-mono"
            />
          </div>
          <button onClick={refresh}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-400 hover:text-slate-200
              hover:bg-slate-800 border border-slate-800 transition-all">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {loading && vms.length === 0 ? (
        <div className="flex items-center justify-center py-20 gap-2 text-slate-500">
          <Spinner /> <span className="text-sm font-mono">Loading VMs...</span>
        </div>
      ) : error ? (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-red-400 text-sm font-mono">{error}</div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={Server} title={search ? 'No VMs match your search' : 'No VMs found'} />
      ) : (
        <div className="grid gap-3">
          {filtered.map(vm => (
            <div key={vm.Name}
              className="bg-[#0f1318] border border-slate-800 rounded-2xl p-4 hover:border-slate-700 transition-all">

              {/* Row 1: Name · Status · Meta · Delete button */}
              <div className="flex items-center gap-3 mb-3 min-w-0">
                <button
                  onClick={() => navigate(`/vms/${encodeURIComponent(vm.Name)}`)}
                  className="font-mono text-sm font-semibold text-slate-100 hover:text-blue-400 transition-colors flex items-center gap-1 shrink-0"
                >
                  {vm.Name}
                  <ChevronRight size={13} className="text-slate-600" />
                </button>

                <StatusBadge state={vm.State} />

                <span className="text-[11px] text-slate-600 font-mono hidden md:block truncate">
                  Gen {vm.Generation} · v{vm.Version} · {vm.ProcessorCount} vCPU
                </span>

                {user?.role === 'admin' && (
                  <button
                    onClick={() => handleDeleteVM(vm)}
                    disabled={deletingVM === vm.Name}
                    className="ml-auto p-1.5 rounded text-slate-700 hover:text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-40 shrink-0"
                    title="Delete VM"
                  >
                    {deletingVM === vm.Name
                      ? <Loader size={12} className="animate-spin" />
                      : <Trash2 size={12} />}
                  </button>
                )}
              </div>

              {/* Row 2: CPU bar · RAM bar · divider · action buttons */}
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-5 shrink-0">
                  <div className="w-24">
                    <div className="flex justify-between text-[10px] font-mono text-slate-500 mb-1">
                      <span>CPU</span><span>{vm.CPUUsage || 0}%</span>
                    </div>
                    <ProgressBar value={vm.CPUUsage || 0} color="blue" />
                  </div>
                  <div className="w-24">
                    <div className="flex justify-between text-[10px] font-mono text-slate-500 mb-1">
                      <span>RAM</span><span>{vm.MemoryAssignedGB || 0} GB</span>
                    </div>
                    <ProgressBar value={vm.MemoryDemandGB || 0} max={vm.MemoryAssignedGB || 1} color="purple" />
                  </div>
                </div>

                <div className="hidden sm:block w-px h-6 bg-slate-800 shrink-0" />

                <div className="flex-1 min-w-0">
                  <VMActionBar
                    vm={vm}
                    userRole={user?.role}
                    onAction={(type, msg) => {
                      type === 'error' ? toast.error(msg) : toast.success(msg);
                      // refresh() forces an immediate Hyper-V sync and then
                      // polls at 2s/4s/8s to catch state transitions
                      if (type !== 'error') refresh();
                    }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
