import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/Toast';
import { Spinner } from '../components/UI';
import * as api from '../api';
import {
  Bell, BellOff, Plus, Trash2, X, Loader, AlertCircle,
  CheckCircle, RefreshCw, ChevronDown, Mail, Globe, Clock
} from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';

const METRICS = [
  { value: 'cpu',     label: 'CPU Usage',     unit: '%',  ops: ['gt', 'lt'] },
  { value: 'memory',  label: 'Memory Usage',  unit: '%',  ops: ['gt', 'lt'] },
  { value: 'vm_down', label: 'VM Goes Offline', unit: '', ops: ['eq'] },
  { value: 'vm_up',   label: 'VM Comes Online', unit: '', ops: ['eq'] },
];

const OP_LABELS = { gt: '>', lt: '<', eq: '=' };
const METRIC_LABELS = Object.fromEntries(METRICS.map(m => [m.value, m.label]));

// ─── Create Rule Modal ────────────────────────────────────────────────────────

function CreateAlertModal({ vms, onDone, onCancel }) {
  const [form, setForm] = useState({
    vm_name: '',
    metric: 'cpu',
    operator: 'gt',
    threshold: 90,
    notify_email: '',
    notify_webhook: '',
    cooldown_minutes: 30,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const set = f => v => setForm(p => ({ ...p, [f]: v }));

  const selectedMetric = METRICS.find(m => m.value === form.metric);

  // Auto-set operator when metric changes
  const handleMetricChange = (metric) => {
    const m = METRICS.find(x => x.value === metric);
    setForm(p => ({ ...p, metric, operator: m?.ops[0] || 'gt', threshold: metric === 'vm_down' || metric === 'vm_up' ? 1 : p.threshold }));
  };

  const handleCreate = async () => {
    if (!form.notify_email && !form.notify_webhook) {
      return setError('Add at least one notification method (email or webhook)');
    }
    setLoading(true); setError('');
    try {
      await api.createAlert(form);
      onDone('Alert rule created');
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      setLoading(false);
    }
  };

  const inputCls = "w-full bg-[#0f1318] border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 font-mono focus:outline-none focus:border-blue-500/60";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#151a22] border border-slate-700 rounded-2xl p-5 w-full max-w-md shadow-2xl mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Bell size={15} className="text-yellow-400" />
            <h3 className="font-semibold text-slate-100 text-sm">Create Alert Rule</h3>
          </div>
          <button onClick={onCancel} className="text-slate-500 hover:text-slate-300"><X size={16} /></button>
        </div>

        {error && (
          <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-lg p-2.5 mb-3 text-sm text-red-300">
            <AlertCircle size={13} />{error}
          </div>
        )}

        <div className="space-y-3">
          {/* VM target */}
          <div>
            <label className="block text-xs font-mono text-slate-400 uppercase mb-1.5">Apply to VM</label>
            <select value={form.vm_name} onChange={e => set('vm_name')(e.target.value)} className={inputCls}>
              <option value="">All VMs</option>
              {vms.map(v => <option key={v.Name} value={v.Name}>{v.Name}</option>)}
            </select>
          </div>

          {/* Metric */}
          <div>
            <label className="block text-xs font-mono text-slate-400 uppercase mb-1.5">Metric</label>
            <div className="grid grid-cols-2 gap-1.5">
              {METRICS.map(m => (
                <button key={m.value}
                  onClick={() => handleMetricChange(m.value)}
                  className={`py-2 px-3 rounded-lg text-xs font-mono text-left border transition-all
                    ${form.metric === m.value
                      ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-300'
                      : 'bg-[#0f1318] border-slate-700 text-slate-400 hover:border-slate-600'}`}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Condition — only show for value-based metrics */}
          {selectedMetric && selectedMetric.unit && (
            <div>
              <label className="block text-xs font-mono text-slate-400 uppercase mb-1.5">Condition</label>
              <div className="flex gap-2">
                <select value={form.operator} onChange={e => set('operator')(e.target.value)}
                  className="bg-[#0f1318] border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 font-mono focus:outline-none focus:border-blue-500/60">
                  {selectedMetric.ops.map(op => (
                    <option key={op} value={op}>{OP_LABELS[op]} {op === 'gt' ? 'greater than' : 'less than'}</option>
                  ))}
                </select>
                <input type="number" value={form.threshold} onChange={e => set('threshold')(e.target.value)}
                  min={0} max={100} className={`flex-1 ${inputCls}`}
                  placeholder={`Value in ${selectedMetric.unit}`} />
                <span className="flex items-center text-sm font-mono text-slate-500 pr-1">{selectedMetric.unit}</span>
              </div>
            </div>
          )}

          {/* Cooldown */}
          <div>
            <label className="block text-xs font-mono text-slate-400 uppercase mb-1.5">
              Cooldown (minutes between alerts)
            </label>
            <input type="number" value={form.cooldown_minutes} onChange={e => set('cooldown_minutes')(e.target.value)}
              min={1} max={1440} className={inputCls} />
          </div>

          {/* Notifications */}
          <div className="pt-1 border-t border-slate-800">
            <div className="text-xs font-mono text-slate-500 uppercase mb-2">Notifications (at least one required)</div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Mail size={12} className="text-slate-500 shrink-0" />
                <input type="email" value={form.notify_email} onChange={e => set('notify_email')(e.target.value)}
                  placeholder="alert@example.com" className={inputCls} />
              </div>
              <div className="flex items-center gap-2">
                <Globe size={12} className="text-slate-500 shrink-0" />
                <input type="url" value={form.notify_webhook} onChange={e => set('notify_webhook')(e.target.value)}
                  placeholder="https://hooks.slack.com/..." className={inputCls} />
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-2 justify-end mt-5">
          <button onClick={onCancel} className="px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-all">
            Cancel
          </button>
          <button onClick={handleCreate} disabled={loading}
            className="px-3 py-1.5 text-sm font-medium text-white bg-yellow-600 hover:bg-yellow-500 disabled:opacity-60 rounded-lg transition-all flex items-center gap-1.5">
            {loading ? <Loader size={12} className="animate-spin" /> : <Bell size={12} />}
            Create Rule
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Rule Row ─────────────────────────────────────────────────────────────────

function RuleRow({ rule, onDelete, onToggle }) {
  const [deleting, setDeleting] = useState(false);
  const [toggling, setToggling] = useState(false);

  const metric = METRICS.find(m => m.value === rule.metric);
  const condition = metric?.unit
    ? `${OP_LABELS[rule.operator]} ${rule.threshold}${metric.unit}`
    : 'triggered';

  return (
    <div className={`flex items-center gap-3 px-4 py-3 border-b border-slate-800/50 hover:bg-slate-800/10 transition-colors
      ${!rule.enabled ? 'opacity-50' : ''}`}>
      <div className={`w-1.5 h-8 rounded-full shrink-0 ${rule.enabled ? 'bg-yellow-500' : 'bg-slate-700'}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-mono text-slate-200 font-medium">
            {rule.vm_name || 'All VMs'}
          </span>
          <span className="text-[10px] font-mono text-yellow-400 bg-yellow-500/10 px-1.5 py-0.5 rounded">
            {METRIC_LABELS[rule.metric]}
          </span>
          <span className="text-[10px] font-mono text-slate-500">{condition}</span>
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-[10px] font-mono text-slate-600">
          {rule.notify_email && (
            <span className="flex items-center gap-1"><Mail size={9} />{rule.notify_email}</span>
          )}
          {rule.notify_webhook && (
            <span className="flex items-center gap-1"><Globe size={9} />webhook</span>
          )}
          <span className="flex items-center gap-1"><Clock size={9} />{rule.cooldown_minutes}m cooldown</span>
          {rule.last_triggered && (
            <span>last fired {formatDistanceToNow(new Date(rule.last_triggered), { addSuffix: true })}</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={async () => { setToggling(true); await onToggle(rule); setToggling(false); }}
          disabled={toggling}
          className={`px-2 py-1 rounded text-[10px] font-mono border transition-all
            ${rule.enabled
              ? 'text-yellow-400 border-yellow-500/20 hover:bg-yellow-500/10'
              : 'text-slate-500 border-slate-700 hover:bg-slate-800'}`}>
          {toggling ? <Loader size={10} className="animate-spin" /> : rule.enabled ? 'On' : 'Off'}
        </button>
        <button
          onClick={async () => { setDeleting(true); await onDelete(rule.id); }}
          disabled={deleting}
          className="p-1.5 rounded text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-all">
          {deleting ? <Loader size={12} className="animate-spin" /> : <Trash2 size={12} />}
        </button>
      </div>
    </div>
  );
}

// ─── Event Row ────────────────────────────────────────────────────────────────

function EventRow({ event }) {
  return (
    <div className="flex items-start gap-3 px-4 py-2.5 border-b border-slate-800/40 hover:bg-slate-800/10">
      <AlertCircle size={12} className="text-yellow-400 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-mono text-slate-300 truncate">{event.message}</div>
        <div className="text-[10px] font-mono text-slate-600 mt-0.5">
          {format(new Date(event.created_at), 'MMM d, yyyy · HH:mm:ss')}
        </div>
      </div>
      <span className="text-[10px] font-mono text-slate-600 shrink-0">
        {event.vm_name}
      </span>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AlertsPage() {
  const toast = useToast();
  const [rules, setRules]   = useState([]);
  const [events, setEvents] = useState([]);
  const [vms, setVMs]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [tab, setTab]       = useState('rules'); // 'rules' | 'events'

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, e, v] = await Promise.all([
        api.getAlerts(),
        api.getAlertEvents(100),
        api.listVMs(),
      ]);
      setRules(r);
      setEvents(e);
      setVMs(Array.isArray(v) ? v : []);
    } catch (err) {
      toast.error('Failed to load alerts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id) => {
    try {
      await api.deleteAlert(id);
      setRules(r => r.filter(x => x.id !== id));
      toast.success('Rule deleted');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Delete failed');
    }
  };

  const handleToggle = async (rule) => {
    try {
      await api.updateAlert(rule.id, { enabled: !rule.enabled });
      setRules(r => r.map(x => x.id === rule.id ? { ...x, enabled: !rule.enabled } : x));
    } catch (err) {
      toast.error('Update failed');
    }
  };

  const activeCount = rules.filter(r => r.enabled).length;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <ToastContainer toasts={toast.toasts} removeToast={toast.removeToast} />

      {showCreate && (
        <CreateAlertModal
          vms={vms}
          onDone={(msg) => { toast.success(msg); setShowCreate(false); load(); }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Resource Alerts</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {activeCount} active rule{activeCount !== 1 ? 's' : ''} · monitored every 60 seconds
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-all">
            <RefreshCw size={14} />
          </button>
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-white bg-yellow-600 hover:bg-yellow-500 transition-all">
            <Plus size={14} />
            New Rule
          </button>
        </div>
      </div>

      {/* Empty state */}
      {!loading && rules.length === 0 && events.length === 0 && (
        <div className="bg-[#0f1318] border border-slate-800 border-dashed rounded-2xl p-12 text-center">
          <Bell size={28} className="text-slate-700 mx-auto mb-3" />
          <div className="text-sm font-medium text-slate-400 mb-1">No alert rules yet</div>
          <p className="text-xs text-slate-600 max-w-sm mx-auto mb-4">
            Create rules to get notified when a VM's CPU, memory, or availability exceeds your thresholds.
          </p>
          <button onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-yellow-600 hover:bg-yellow-500 transition-all">
            <Plus size={13} /> Create First Rule
          </button>
        </div>
      )}

      {(loading || rules.length > 0 || events.length > 0) && (
        <>
          {/* Tabs */}
          <div className="flex gap-1 mb-4 bg-[#0f1318] border border-slate-800 rounded-xl p-1 w-fit">
            {[
              { key: 'rules',  label: `Rules (${rules.length})` },
              { key: 'events', label: `Recent Events (${events.length})` },
            ].map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-all
                  ${tab === t.key ? 'bg-slate-700 text-slate-200' : 'text-slate-500 hover:text-slate-300'}`}>
                {t.label}
              </button>
            ))}
          </div>

          <div className="bg-[#0f1318] border border-slate-800 rounded-2xl overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center py-16"><Spinner /></div>
            ) : tab === 'rules' ? (
              rules.length === 0 ? (
                <div className="py-12 text-center">
                  <BellOff size={20} className="text-slate-700 mx-auto mb-2" />
                  <div className="text-xs font-mono text-slate-600">No rules defined</div>
                </div>
              ) : (
                rules.map(rule => (
                  <RuleRow key={rule.id} rule={rule} onDelete={handleDelete} onToggle={handleToggle} />
                ))
              )
            ) : (
              events.length === 0 ? (
                <div className="py-12 text-center">
                  <CheckCircle size={20} className="text-slate-700 mx-auto mb-2" />
                  <div className="text-xs font-mono text-slate-600">No alerts fired yet</div>
                </div>
              ) : (
                events.map(e => <EventRow key={e.id} event={e} />)
              )
            )}
          </div>
        </>
      )}

      {/* Info box */}
      <div className="mt-4 bg-[#0f1318] border border-slate-800 rounded-xl p-4 grid grid-cols-3 gap-4">
        {[
          { icon: Bell,   title: 'How it works', desc: 'The monitor checks all running VMs every 60 seconds and fires rules when thresholds are crossed.' },
          { icon: Mail,   title: 'Email alerts',  desc: 'Configure SMTP credentials in Settings to receive email notifications when rules trigger.' },
          { icon: Globe,  title: 'Webhooks',      desc: 'Paste any webhook URL (Slack, Discord, Teams, custom) to receive a POST with alert details.' },
        ].map(({ icon: Icon, title, desc }) => (
          <div key={title} className="flex items-start gap-2.5">
            <Icon size={13} className="text-slate-500 mt-0.5 shrink-0" />
            <div>
              <div className="text-xs font-mono text-slate-300 mb-0.5">{title}</div>
              <div className="text-[10px] text-slate-600 leading-relaxed">{desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
