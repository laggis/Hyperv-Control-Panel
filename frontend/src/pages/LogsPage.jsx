import { useState, useEffect, useCallback } from 'react';
import { getLogs } from '../api';
import { Badge, Spinner, EmptyState } from '../components/UI';
import { ClipboardList, ChevronLeft, ChevronRight, Filter } from 'lucide-react';
import { format } from 'date-fns';

const ACTION_BADGE = {
  VM_START: 'green',
  VM_STOP: 'red',
  VM_RESTART: 'yellow',
  VM_SUSPEND: 'yellow',
  VM_RESUME: 'green',
  SNAPSHOT_CREATE: 'blue',
  SNAPSHOT_RESTORE: 'yellow',
  SNAPSHOT_DELETE: 'red',
  LOGIN: 'default',
  LOGIN_ANOMALY: 'yellow',
};

export default function LogsPage() {
  const [data, setData] = useState({ logs: [], pagination: {} });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [vmFilter, setVmFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getLogs({
        page,
        limit: 50,
        ...(vmFilter && { vm: vmFilter }),
        ...(actionFilter && { action: actionFilter }),
      });
      setData(result);
    } catch {}
    finally { setLoading(false); }
  }, [page, vmFilter, actionFilter]);

  useEffect(() => { fetch(); }, [fetch]);

  const { logs, pagination } = data;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Audit Logs</h1>
          <p className="text-sm text-slate-500 mt-0.5">All actions performed on virtual machines</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <div className="relative">
          <Filter size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            placeholder="Filter by VM..."
            value={vmFilter}
            onChange={e => { setVmFilter(e.target.value); setPage(1); }}
            className="bg-[#0f1318] border border-slate-800 rounded-lg pl-8 pr-3 py-2 text-sm text-slate-300
              placeholder:text-slate-600 focus:outline-none focus:border-slate-600 w-44 font-mono"
          />
        </div>
        <select
          value={actionFilter}
          onChange={e => { setActionFilter(e.target.value); setPage(1); }}
          className="bg-[#0f1318] border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-300
            focus:outline-none focus:border-slate-600 font-mono"
        >
          <option value="">All Actions</option>
          <option value="VM_START">VM Start</option>
          <option value="VM_STOP">VM Stop</option>
          <option value="VM_RESTART">VM Restart</option>
          <option value="VM_SUSPEND">VM Suspend</option>
          <option value="VM_RESUME">VM Resume</option>
          <option value="SNAPSHOT_CREATE">Snapshot Create</option>
          <option value="SNAPSHOT_RESTORE">Snapshot Restore</option>
          <option value="SNAPSHOT_DELETE">Snapshot Delete</option>
          <option value="LOGIN">Login</option>
          <option value="LOGIN_ANOMALY">Login Anomaly</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-[#0f1318] border border-slate-800 rounded-2xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 gap-2 text-slate-500">
            <Spinner />
          </div>
        ) : logs.length === 0 ? (
          <EmptyState icon={ClipboardList} title="No logs found" description="Actions will appear here as VMs are managed" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] font-mono text-slate-600 uppercase tracking-wider border-b border-slate-800">
                  <th className="text-left px-5 py-2.5">Time</th>
                  <th className="text-left px-4 py-2.5">User</th>
                  <th className="text-left px-4 py-2.5">Action</th>
                  <th className="text-left px-4 py-2.5">VM</th>
                  <th className="text-left px-4 py-2.5">Status</th>
                  <th className="text-left px-4 py-2.5">Details</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(log => (
                  <tr key={log.id} className="border-b border-slate-800/40 hover:bg-slate-800/15">
                    <td className="px-5 py-2.5 text-xs font-mono text-slate-500 whitespace-nowrap">
                      {format(new Date(log.created_at), 'MMM d · HH:mm:ss')}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="text-sm font-mono text-slate-300">{log.username || '—'}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant={ACTION_BADGE[log.action] || 'default'}>
                        {log.action}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="text-xs font-mono text-slate-400">{log.vm_name || '—'}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant={log.status === 'success' ? 'green' : 'red'}>
                        {log.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="text-xs text-slate-600 font-mono truncate max-w-[200px] block" title={log.details}>
                        {log.details || '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {pagination.pages > 1 && (
          <div className="px-5 py-3 border-t border-slate-800 flex items-center justify-between">
            <span className="text-xs font-mono text-slate-500">
              {pagination.total} entries · Page {pagination.page} of {pagination.pages}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-1.5 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 disabled:opacity-30 transition-all"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                onClick={() => setPage(p => Math.min(pagination.pages, p + 1))}
                disabled={page === pagination.pages}
                className="p-1.5 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 disabled:opacity-30 transition-all"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
