import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/Toast';
import { Spinner } from '../components/UI';
import * as api from '../api';
import {
  Users, Plus, Trash2, X, Edit2, Server, Link, Unlink, Loader,
  Mail, Phone, FileText, CreditCard, ChevronDown, ChevronUp, Check,
  MessageSquare, Phone as PhoneIcon, AtSign, Ticket, DollarSign,
  MoreHorizontal, Calendar, AlertTriangle, BarChart2, Download,
  RefreshCw, Clock, Activity
} from 'lucide-react';
import { format, formatDistanceToNow, isPast, differenceInDays } from 'date-fns';

const COLORS = [
  '#3b82f6','#8b5cf6','#ec4899','#ef4444','#f97316',
  '#eab308','#22c55e','#14b8a6','#06b6d4','#64748b',
];

const NOTE_TYPES = [
  { value: 'note',    label: 'Note',    icon: FileText,      color: 'text-slate-400' },
  { value: 'call',    label: 'Call',    icon: PhoneIcon,     color: 'text-green-400' },
  { value: 'email',   label: 'Email',   icon: AtSign,        color: 'text-blue-400'  },
  { value: 'ticket',  label: 'Ticket',  icon: Ticket,        color: 'text-yellow-400'},
  { value: 'billing', label: 'Billing', icon: DollarSign,    color: 'text-purple-400'},
  { value: 'other',   label: 'Other',   icon: MoreHorizontal,color: 'text-slate-500' },
];

const inputCls = `w-full bg-[#0a0d12] border border-slate-700 rounded-lg px-3 py-2 text-sm
  text-slate-200 font-mono placeholder:text-slate-600 focus:outline-none focus:border-blue-500/60 transition-all`;

// ─── Color picker ─────────────────────────────────────────────────────────────
function ColorDot({ color, selected, onClick }) {
  return (
    <button onClick={onClick}
      className="w-6 h-6 rounded-full border-2 transition-all flex items-center justify-center"
      style={{ backgroundColor: color, borderColor: selected ? 'white' : 'transparent' }}>
      {selected && <Check size={10} className="text-white" strokeWidth={3} />}
    </button>
  );
}

// ─── Client form modal ────────────────────────────────────────────────────────
function ClientModal({ client, onSave, onClose }) {
  const isEdit = !!client?.id;
  const [form, setForm] = useState({
    name:            client?.name            || '',
    contact_name:    client?.contact_name    || '',
    email:           client?.email           || '',
    phone:           client?.phone           || '',
    notes:           client?.notes           || '',
    billing_plan:    client?.billing_plan    || '',
    billing_amount:  client?.billing_amount  || '',
    billing_cycle:   client?.billing_cycle   || 'monthly',
    color:           client?.color           || '#3b82f6',
    renewal_date:    client?.renewal_date    ? client.renewal_date.slice(0, 10) : '',
    renewal_amount:  client?.renewal_amount  || '',
    renewal_notes:   client?.renewal_notes   || '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleSave = async () => {
    if (!form.name.trim()) return setError('Client name is required');
    setLoading(true); setError('');
    try {
      const payload = {
        ...form,
        billing_amount: form.billing_amount ? parseFloat(form.billing_amount) : null,
        renewal_amount: form.renewal_amount ? parseFloat(form.renewal_amount) : null,
        renewal_date:   form.renewal_date   || null,
      };
      if (isEdit) await api.updateClient(client.id, payload);
      else        await api.createClient(payload);
      onSave();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      setLoading(false);
    }
  };

  const F = ({ label, name, type='text', placeholder }) => (
    <div>
      <label className="block text-xs font-mono text-slate-400 mb-1 uppercase tracking-wide">{label}</label>
      <input type={type} value={form[name]} onChange={e => set(name, e.target.value)}
        placeholder={placeholder} className={inputCls} />
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-[#0f1318] border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl mx-4 animate-slide-up overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: form.color }} />
            <h3 className="font-semibold text-slate-100 text-sm">{isEdit ? 'Edit Client' : 'New Client'}</h3>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4 max-h-[72vh] overflow-y-auto">
          {error && <div className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg p-2.5">{error}</div>}

          {/* Color */}
          <div>
            <label className="block text-xs font-mono text-slate-400 mb-2 uppercase tracking-wide">Colour Tag</label>
            <div className="flex gap-2 flex-wrap">{COLORS.map(c => <ColorDot key={c} color={c} selected={form.color===c} onClick={() => set('color',c)} />)}</div>
          </div>

          <F label="Company / Client Name *" name="name" placeholder="Acme Corp" />
          <div className="grid grid-cols-2 gap-3">
            <F label="Contact Name" name="contact_name" placeholder="John Smith" />
            <F label="Phone" name="phone" placeholder="+46 70 000 0000" />
          </div>
          <F label="Email" name="email" type="email" placeholder="contact@acme.com" />

          {/* Billing */}
          <div className="pt-1 border-t border-slate-800">
            <div className="text-xs font-mono text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <CreditCard size={10} /> Billing
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2"><F label="Plan Name" name="billing_plan" placeholder="VPS Basic" /></div>
              <F label="Amount" name="billing_amount" type="number" placeholder="499" />
            </div>
            <div className="mt-3">
              <label className="block text-xs font-mono text-slate-400 mb-1 uppercase tracking-wide">Billing Cycle</label>
              <select value={form.billing_cycle} onChange={e => set('billing_cycle', e.target.value)}
                className={inputCls}>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="yearly">Yearly</option>
                <option value="one-time">One-time</option>
              </select>
            </div>
          </div>

          {/* Renewal */}
          <div className="pt-1 border-t border-slate-800">
            <div className="text-xs font-mono text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Calendar size={10} /> Renewal
            </div>
            <div className="grid grid-cols-2 gap-3">
              <F label="Renewal Date" name="renewal_date" type="date" />
              <F label="Renewal Amount" name="renewal_amount" type="number" placeholder="499" />
            </div>
            <div className="mt-3">
              <label className="block text-xs font-mono text-slate-400 mb-1 uppercase tracking-wide">Renewal Notes</label>
              <input value={form.renewal_notes} onChange={e => set('renewal_notes', e.target.value)}
                placeholder="e.g. Auto-renews, needs invoice..." className={inputCls} />
            </div>
          </div>

          {/* Notes */}
          <div className="pt-1 border-t border-slate-800">
            <label className="block text-xs font-mono text-slate-400 mb-1 uppercase tracking-wide">General Notes</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2}
              placeholder="Any notes about this client..."
              className={`${inputCls} resize-none`} />
          </div>
        </div>

        <div className="flex gap-2 justify-end px-5 py-4 border-t border-slate-800">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-all">Cancel</button>
          <button onClick={handleSave} disabled={loading}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-all flex items-center gap-1.5 disabled:opacity-60">
            {loading ? <Loader size={13} className="animate-spin" /> : <Check size={13} />}
            {isEdit ? 'Save Changes' : 'Create Client'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Assign VM modal ──────────────────────────────────────────────────────────
function AssignVMModal({ client, allVMs, assignments, onSave, onClose }) {
  const [loading, setLoading] = useState(null);
  const myVMs        = assignments.filter(a => a.client_id === client.id).map(a => a.vm_name);
  const otherAssigned = assignments.filter(a => a.client_id !== client.id).map(a => a.vm_name);

  const handleAssign = async (vmName) => {
    setLoading(vmName);
    try { await api.assignVM(client.id, vmName); onSave(); } catch {}
    finally { setLoading(null); }
  };
  const handleUnassign = async (vmName) => {
    setLoading(vmName);
    try { await api.unassignVM(vmName); onSave(); } catch {}
    finally { setLoading(null); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-[#0f1318] border border-slate-700 rounded-2xl w-full max-w-sm shadow-2xl mx-4 animate-slide-up overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: client.color }} />
            <div>
              <h3 className="font-semibold text-slate-100 text-sm">Assign VMs</h3>
              <p className="text-xs text-slate-500 font-mono">{client.name}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300"><X size={16} /></button>
        </div>
        <div className="p-3 max-h-80 overflow-y-auto space-y-1">
          {allVMs.length === 0 && <p className="text-center text-slate-600 text-sm py-8 font-mono">No VMs found</p>}
          {allVMs.map(vm => {
            const isHere   = myVMs.includes(vm.Name);
            const isOther  = otherAssigned.includes(vm.Name);
            const otherCl  = isOther ? assignments.find(a => a.vm_name === vm.Name) : null;
            const isBusy   = loading === vm.Name;
            return (
              <div key={vm.Name}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all
                  ${isHere ? 'bg-blue-500/8 border-blue-500/20' : 'bg-slate-800/30 border-slate-800'}`}>
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${vm.State === 'Running' ? 'bg-green-400' : 'bg-slate-600'}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-mono text-slate-200 truncate">{vm.Name}</div>
                  {isOther && !isHere && <div className="text-[10px] text-slate-500">→ {otherCl?.client_name}</div>}
                </div>
                {isHere ? (
                  <button onClick={() => handleUnassign(vm.Name)} disabled={isBusy}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-mono text-red-400 hover:bg-red-500/10 border border-red-500/20 transition-all disabled:opacity-50">
                    {isBusy ? <Loader size={10} className="animate-spin" /> : <Unlink size={10} />} Remove
                  </button>
                ) : (
                  <button onClick={() => handleAssign(vm.Name)} disabled={isBusy}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-mono text-blue-400 hover:bg-blue-500/10 border border-blue-500/20 transition-all disabled:opacity-50">
                    {isBusy ? <Loader size={10} className="animate-spin" /> : <Link size={10} />} Assign
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <div className="px-5 py-3 border-t border-slate-800 text-right">
          <button onClick={onClose} className="px-4 py-1.5 text-sm text-slate-300 hover:text-white hover:bg-slate-700 rounded-lg transition-all">Done</button>
        </div>
      </div>
    </div>
  );
}

// ─── Notes panel ─────────────────────────────────────────────────────────────
function NotesPanel({ clientId, currentUser }) {
  const [notes, setNotes]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm]       = useState({ type: 'note', subject: '', body: '' });
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');
  const [editId, setEditId]   = useState(null);

  const load = useCallback(async () => {
    try { setNotes(await api.getClientNotes(clientId)); }
    catch {} finally { setLoading(false); }
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  const handleSubmit = async () => {
    if (!form.body.trim()) return setError('Body is required');
    setSaving(true); setError('');
    try {
      if (editId) {
        await api.updateClientNote(clientId, editId, form);
        setEditId(null);
      } else {
        await api.createClientNote(clientId, form);
      }
      setForm({ type: 'note', subject: '', body: '' });
      await load();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally { setSaving(false); }
  };

  const handleDelete = async (noteId) => {
    try { await api.deleteClientNote(clientId, noteId); await load(); } catch {}
  };

  const startEdit = (note) => {
    setEditId(note.id);
    setForm({ type: note.type, subject: note.subject || '', body: note.body });
  };

  const NoteTypeIcon = ({ type, className }) => {
    const t = NOTE_TYPES.find(x => x.value === type) || NOTE_TYPES[0];
    const Icon = t.icon;
    return <Icon size={12} className={`${t.color} ${className}`} />;
  };

  return (
    <div className="space-y-3">
      {/* Compose */}
      <div className="bg-[#0b0e14] border border-slate-800 rounded-xl p-3">
        <div className="flex gap-2 mb-2 flex-wrap">
          {NOTE_TYPES.map(t => {
            const Icon = t.icon;
            return (
              <button key={t.value}
                onClick={() => setForm(f => ({ ...f, type: t.value }))}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-mono transition-all border
                  ${form.type === t.value ? 'bg-slate-700 border-slate-600 text-slate-200' : 'border-slate-800 text-slate-600 hover:text-slate-400'}`}>
                <Icon size={9} className={t.color} />{t.label}
              </button>
            );
          })}
        </div>
        <input value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
          placeholder="Subject (optional)" className={`${inputCls} mb-2 text-xs`} />
        <textarea value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
          rows={2} placeholder="Write a note..."
          className={`${inputCls} resize-none text-xs`} />
        {error && <div className="text-red-400 text-xs mt-1">{error}</div>}
        <div className="flex gap-2 justify-end mt-2">
          {editId && (
            <button onClick={() => { setEditId(null); setForm({ type: 'note', subject: '', body: '' }); }}
              className="text-xs text-slate-500 hover:text-slate-300 px-2 py-1">Cancel</button>
          )}
          <button onClick={handleSubmit} disabled={saving || !form.body.trim()}
            className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-mono rounded-lg disabled:opacity-50 transition-all">
            {saving ? <Loader size={10} className="animate-spin" /> : <Plus size={10} />}
            {editId ? 'Update' : 'Add Note'}
          </button>
        </div>
      </div>

      {/* Notes list */}
      {loading ? (
        <div className="flex justify-center py-4"><Spinner /></div>
      ) : notes.length === 0 ? (
        <div className="text-center py-6 text-xs font-mono text-slate-600">No notes yet</div>
      ) : (
        <div className="space-y-2">
          {notes.map(note => {
            const canEdit = currentUser?.role === 'admin' || note.user_id === currentUser?.id;
            return (
              <div key={note.id} className="bg-[#0b0e14] border border-slate-800 rounded-xl p-3">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="flex items-center gap-1.5">
                    <NoteTypeIcon type={note.type} />
                    {note.subject && <span className="text-xs font-mono text-slate-300 font-medium">{note.subject}</span>}
                    <span className="text-[10px] font-mono text-slate-600">
                      {NOTE_TYPES.find(t => t.value === note.type)?.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-[10px] text-slate-700 font-mono">
                      {note.username} · {formatDistanceToNow(new Date(note.created_at), { addSuffix: true })}
                    </span>
                    {canEdit && (
                      <>
                        <button onClick={() => startEdit(note)}
                          className="p-1 text-slate-700 hover:text-slate-400 transition-colors"><Edit2 size={10} /></button>
                        <button onClick={() => handleDelete(note.id)}
                          className="p-1 text-slate-700 hover:text-red-400 transition-colors"><Trash2 size={10} /></button>
                      </>
                    )}
                  </div>
                </div>
                <p className="text-xs text-slate-400 font-mono whitespace-pre-wrap leading-relaxed">{note.body}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Report modal ─────────────────────────────────────────────────────────────
function ReportModal({ client, onClose }) {
  const [days, setDays]       = useState(30);
  const [report, setReport]   = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setReport(await api.getClientReport(client.id, days)); }
    catch {} finally { setLoading(false); }
  }, [client.id, days]);

  useEffect(() => { load(); }, [load]);

  const formatBytes = (b) => {
    if (!b) return '0 B';
    const k = 1024, sizes = ['B','KB','MB','GB'];
    const i = Math.floor(Math.log(b) / Math.log(k));
    return `${(b / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  const handleDownload = () => {
    if (!report) return;
    const lines = [
      `VM USAGE REPORT — ${client.name}`,
      `Period: Last ${days} days`,
      `Generated: ${new Date().toLocaleString()}`,
      '',
      ...report.vms.map(v => [
        `VM: ${v.vm_name}`,
        `  Uptime:   ${v.uptime_pct !== null ? v.uptime_pct + '%' : 'No data'}`,
        `  Net In:   ${formatBytes(v.total_in)}`,
        `  Net Out:  ${formatBytes(v.total_out)}`,
        `  Samples:  ${v.samples}`,
        '',
      ].join('\n')),
    ].join('\n');

    const blob = new Blob([lines], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `${client.name.replace(/\s+/g, '_')}_report_${days}d.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-[#0f1318] border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl mx-4 animate-slide-up overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <BarChart2 size={15} className="text-blue-400" />
            <div>
              <h3 className="font-semibold text-slate-100 text-sm">VM Usage Report</h3>
              <p className="text-xs text-slate-500 font-mono">{client.name}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300"><X size={16} /></button>
        </div>

        <div className="p-5">
          {/* Period selector */}
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xs font-mono text-slate-500">Period:</span>
            {[7, 14, 30, 90].map(d => (
              <button key={d} onClick={() => setDays(d)}
                className={`px-2.5 py-1 rounded-lg text-xs font-mono transition-all border
                  ${days === d ? 'bg-blue-500/15 border-blue-500/30 text-blue-300' : 'border-slate-700 text-slate-500 hover:text-slate-300'}`}>
                {d}d
              </button>
            ))}
            <button onClick={load} className="ml-auto text-slate-600 hover:text-slate-400"><RefreshCw size={12} /></button>
          </div>

          {loading ? (
            <div className="flex justify-center py-10"><Spinner /></div>
          ) : !report ? (
            <div className="text-center py-8 text-slate-600 text-sm font-mono">Failed to load report</div>
          ) : report.vms.length === 0 ? (
            <div className="text-center py-8 text-slate-600 text-sm font-mono">No VMs assigned to this client</div>
          ) : (
            <div className="space-y-3 max-h-80 overflow-y-auto">
              {report.vms.map(v => (
                <div key={v.vm_name} className="bg-[#0b0e14] border border-slate-800 rounded-xl p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-mono text-slate-200 font-medium">{v.vm_name}</span>
                    {v.uptime_pct !== null && (
                      <span className={`text-xs font-mono px-2 py-0.5 rounded-full border
                        ${v.uptime_pct >= 99 ? 'text-green-400 bg-green-500/10 border-green-500/20'
                        : v.uptime_pct >= 95 ? 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20'
                        : 'text-red-400 bg-red-500/10 border-red-500/20'}`}>
                        {v.uptime_pct}% uptime
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    {[
                      { label: 'Uptime', value: v.uptime_pct !== null ? `${v.uptime_pct}%` : '—', icon: Activity },
                      { label: 'Net In',  value: formatBytes(v.total_in),  icon: Clock },
                      { label: 'Net Out', value: formatBytes(v.total_out), icon: Clock },
                    ].map(({ label, value, icon: Icon }) => (
                      <div key={label} className="bg-slate-800/40 rounded-lg p-2">
                        <div className="text-[10px] font-mono text-slate-600 uppercase mb-1">{label}</div>
                        <div className="text-sm font-mono text-slate-300 font-medium">{value}</div>
                      </div>
                    ))}
                  </div>
                  {v.samples === 0 && (
                    <div className="text-[10px] text-slate-700 font-mono mt-1.5 text-center">
                      No monitoring data yet — data is collected every 60s
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-2 justify-between px-5 py-4 border-t border-slate-800">
          <button onClick={handleDownload} disabled={!report || report.vms.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono text-slate-400 border border-slate-700 hover:bg-slate-800 rounded-lg transition-all disabled:opacity-40">
            <Download size={12} /> Export .txt
          </button>
          <button onClick={onClose} className="px-4 py-1.5 text-sm text-slate-300 hover:text-white hover:bg-slate-700 rounded-lg transition-all">Close</button>
        </div>
      </div>
    </div>
  );
}

// ─── Client card ──────────────────────────────────────────────────────────────
function ClientCard({ client, assignments, allVMs, onEdit, onRefresh, isAdmin, currentUser }) {
  const [tab, setTab]           = useState('overview'); // overview | notes
  const [showAssign, setShowAssign] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const myVMs = assignments.filter(a => a.client_id === client.id);

  const renewalDays = client.renewal_date
    ? differenceInDays(new Date(client.renewal_date), new Date())
    : null;
  const renewalSoon = renewalDays !== null && renewalDays >= 0 && renewalDays <= 14;
  const renewalOverdue = renewalDays !== null && renewalDays < 0;

  const handleDelete = async () => {
    if (!window.confirm(`Delete client "${client.name}"?`)) return;
    setDeleting(true);
    try { await api.deleteClient(client.id); onRefresh(); }
    catch { setDeleting(false); }
  };

  return (
    <>
      {showAssign && (
        <AssignVMModal client={client} allVMs={allVMs} assignments={assignments}
          onClose={() => setShowAssign(false)} onSave={() => { onRefresh(); }} />
      )}
      {showReport && <ReportModal client={client} onClose={() => setShowReport(false)} />}

      <div className="bg-[#0f1318] border border-slate-800 rounded-2xl overflow-hidden hover:border-slate-700 transition-all">
        <div className="h-1" style={{ backgroundColor: client.color }} />

        <div className="p-4">
          {/* Header */}
          <div className="flex items-start gap-3 mb-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold shrink-0 mt-0.5"
              style={{ backgroundColor: client.color+'25', border:`1.5px solid ${client.color}50`, color: client.color }}>
              {client.name[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-slate-100 truncate">{client.name}</div>
              {client.contact_name && <div className="text-xs text-slate-500 truncate">{client.contact_name}</div>}
              <div className="flex items-center gap-3 mt-1 flex-wrap">
                {client.email && (
                  <a href={`mailto:${client.email}`} className="text-xs text-blue-400 hover:underline flex items-center gap-1 font-mono">
                    <Mail size={9} />{client.email}
                  </a>
                )}
                {client.phone && (
                  <span className="text-xs text-slate-500 flex items-center gap-1 font-mono">
                    <Phone size={9} />{client.phone}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={() => setShowReport(true)} title="Usage Report"
                className="p-1.5 rounded-lg text-slate-500 hover:text-blue-400 hover:bg-blue-500/10 transition-all">
                <BarChart2 size={13} />
              </button>
              <button onClick={() => setShowAssign(true)} title="Assign VMs"
                className="p-1.5 rounded-lg text-slate-500 hover:text-blue-400 hover:bg-blue-500/10 transition-all">
                <Server size={13} />
              </button>
              <button onClick={onEdit} title="Edit"
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-all">
                <Edit2 size={12} />
              </button>
              {isAdmin && (
                <button onClick={handleDelete} disabled={deleting} title="Delete"
                  className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-40">
                  {deleting ? <Loader size={12} className="animate-spin" /> : <Trash2 size={12} />}
                </button>
              )}
            </div>
          </div>

          {/* Renewal warning */}
          {(renewalSoon || renewalOverdue) && (
            <div className={`flex items-center gap-2 text-xs font-mono px-2.5 py-1.5 rounded-lg mb-3 border
              ${renewalOverdue ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400'}`}>
              <AlertTriangle size={10} />
              {renewalOverdue
                ? `Renewal overdue by ${Math.abs(renewalDays)} day${Math.abs(renewalDays) !== 1 ? 's' : ''}`
                : `Renews in ${renewalDays} day${renewalDays !== 1 ? 's' : ''} · ${format(new Date(client.renewal_date), 'MMM d, yyyy')}`}
            </div>
          )}

          {/* Tabs */}
          <div className="flex gap-1 mb-3">
            {[
              { key: 'overview', label: 'Overview', icon: Server },
              { key: 'notes',    label: 'Notes',    icon: MessageSquare },
            ].map(({ key, label, icon: Icon }) => (
              <button key={key} onClick={() => setTab(key)}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-mono transition-all
                  ${tab === key ? 'bg-slate-700 text-slate-200' : 'text-slate-600 hover:text-slate-400'}`}>
                <Icon size={9} />{label}
              </button>
            ))}
          </div>

          {/* Tab: Overview */}
          {tab === 'overview' && (
            <div className="space-y-2">
              {/* Stats */}
              <div className="flex items-center gap-3 flex-wrap">
                <button onClick={() => setShowAssign(true)}
                  className="flex items-center gap-1.5 text-xs font-mono px-2 py-1 rounded-lg border hover:border-blue-500/30 hover:text-blue-400 transition-all"
                  style={{ borderColor: client.color+'30', color: client.color }}>
                  <Server size={10} />{myVMs.length} VM{myVMs.length !== 1 ? 's' : ''}
                </button>
                {client.billing_plan && (
                  <span className="text-xs font-mono text-slate-500 flex items-center gap-1">
                    <CreditCard size={10} />
                    {client.billing_plan}
                    {client.billing_amount
                      ? ` · ${parseFloat(client.billing_amount).toLocaleString()} kr/${client.billing_cycle === 'monthly' ? 'mo' : client.billing_cycle === 'yearly' ? 'yr' : client.billing_cycle}`
                      : ''}
                  </span>
                )}
                {client.renewal_date && !renewalSoon && !renewalOverdue && (
                  <span className="text-xs font-mono text-slate-600 flex items-center gap-1">
                    <Calendar size={10} />
                    Renews {format(new Date(client.renewal_date), 'MMM d, yyyy')}
                  </span>
                )}
              </div>
              {/* VMs */}
              {myVMs.length > 0 && (
                <div className="space-y-1 mt-2">
                  {myVMs.map(a => {
                    const vm = allVMs.find(v => v.Name === a.vm_name);
                    return (
                      <div key={a.vm_name} className="flex items-center gap-2 px-2.5 py-1.5 bg-slate-800/40 rounded-lg">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${vm?.State === 'Running' ? 'bg-green-400' : 'bg-slate-600'}`} />
                        <span className="text-xs font-mono text-slate-300 flex-1">{a.vm_name}</span>
                        <span className="text-[10px] font-mono text-slate-600">{vm?.State || '—'}</span>
                        <button onClick={async () => { await api.unassignVM(a.vm_name); onRefresh(); }}
                          className="text-slate-600 hover:text-red-400 transition-colors"><X size={10} /></button>
                      </div>
                    );
                  })}
                </div>
              )}
              {client.notes && (
                <div className="flex items-start gap-2 text-xs text-slate-500 font-mono bg-slate-800/30 rounded-lg px-2.5 py-2 mt-1">
                  <FileText size={10} className="mt-0.5 shrink-0" />
                  <span className="whitespace-pre-wrap line-clamp-3">{client.notes}</span>
                </div>
              )}
            </div>
          )}

          {/* Tab: Notes */}
          {tab === 'notes' && (
            <NotesPanel clientId={client.id} currentUser={currentUser} />
          )}
        </div>
      </div>
    </>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function ClientsPage() {
  const { user } = useAuth();
  const toast    = useToast();
  const [clients, setClients]         = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [allVMs, setAllVMs]           = useState([]);
  const [loading, setLoading]         = useState(true);
  const [search, setSearch]           = useState('');
  const [modal, setModal]             = useState(null);
  const isAdmin = user?.role === 'admin';

  const load = useCallback(async () => {
    try {
      const [c, a, v] = await Promise.all([
        api.listClients(), api.getAllAssignments(), api.listVMNames(),
      ]);
      setClients(c);
      setAssignments(a);
      setAllVMs(Array.isArray(v) ? v : []);
    } catch { toast.error('Failed to load clients'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = clients.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.contact_name || '').toLowerCase().includes(search.toLowerCase()) ||
    (c.email || '').toLowerCase().includes(search.toLowerCase())
  );

  const totalMonthly = clients.reduce((sum, c) => {
    if (!c.billing_amount) return sum;
    if (c.billing_cycle === 'yearly')    return sum + parseFloat(c.billing_amount) / 12;
    if (c.billing_cycle === 'quarterly') return sum + parseFloat(c.billing_amount) / 3;
    return sum + parseFloat(c.billing_amount || 0);
  }, 0);

  const renewingSoon = clients.filter(c => {
    if (!c.renewal_date) return false;
    const d = differenceInDays(new Date(c.renewal_date), new Date());
    return d >= 0 && d <= 30;
  }).length;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <ToastContainer toasts={toast.toasts} removeToast={toast.removeToast} />

      {modal && (
        <ClientModal
          client={modal.client}
          onClose={() => setModal(null)}
          onSave={() => { setModal(null); load(); toast.success(modal.client ? 'Client updated' : 'Client created'); }}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Clients</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {clients.length} client{clients.length !== 1 ? 's' : ''} · {assignments.length} VM assignment{assignments.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button onClick={() => setModal({ mode: 'create' })}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white transition-all">
          <Plus size={14} /> New Client
        </button>
      </div>

      {/* Summary cards */}
      {clients.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Total Clients',    value: clients.length,                         sub: null },
            { label: 'Assigned VMs',     value: assignments.length,                     sub: `${allVMs.length - assignments.length} unassigned` },
            { label: 'Monthly Revenue',  value: totalMonthly > 0 ? `${Math.round(totalMonthly).toLocaleString()} kr` : '—', sub: null },
            { label: 'Renewing (30d)',   value: renewingSoon,                           sub: renewingSoon > 0 ? 'needs attention' : 'all clear', warn: renewingSoon > 0 },
          ].map(({ label, value, sub, warn }) => (
            <div key={label} className={`bg-[#0f1318] border rounded-xl p-4 ${warn ? 'border-yellow-500/30' : 'border-slate-800'}`}>
              <div className="text-xs font-mono text-slate-500 uppercase tracking-wider mb-2">{label}</div>
              <div className={`text-2xl font-mono font-semibold ${warn ? 'text-yellow-400' : 'text-slate-100'}`}>{value}</div>
              {sub && <div className="text-xs text-slate-600 mt-0.5">{sub}</div>}
            </div>
          ))}
        </div>
      )}

      {/* Search */}
      {clients.length > 0 && (
        <div className="mb-4">
          <input placeholder="Search clients..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full max-w-sm bg-[#0f1318] border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-slate-700 font-mono" />
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-20 gap-2 text-slate-500"><Spinner /><span className="text-sm font-mono">Loading...</span></div>
      ) : filtered.length === 0 && !search ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Users size={36} className="text-slate-700 mb-3" />
          <div className="text-slate-400 font-medium">No clients yet</div>
          <p className="text-sm text-slate-600 mt-1 mb-4">Create your first client to assign VMs and track billing</p>
          <button onClick={() => setModal({ mode: 'create' })}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-all">
            <Plus size={14} /> New Client
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(client => (
            <ClientCard key={client.id} client={client} assignments={assignments}
              allVMs={allVMs} isAdmin={isAdmin} currentUser={user}
              onEdit={() => setModal({ mode: 'edit', client })}
              onDelete={load} onRefresh={load} />
          ))}
        </div>
      )}
    </div>
  );
}
