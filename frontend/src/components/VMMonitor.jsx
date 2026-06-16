import { useState, useEffect, useCallback } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Activity, RefreshCw, Disc, X, Loader } from 'lucide-react';
import { format } from 'date-fns';
import * as api from '../api';

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#1c2330] border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono shadow-xl">
      <div className="text-slate-400 mb-1">{label}</div>
      {payload.map(p => (
        <div key={p.name} style={{ color: p.color }}>
          {p.name}: {formatBytes(p.value)}
        </div>
      ))}
    </div>
  );
};

export function BandwidthChart({ vmName }) {
  const [data, setData]     = useState([]);
  const [hours, setHours]   = useState(24);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api.getBandwidth(vmName, hours);
      setData(rows.map(r => ({
        time: format(new Date(r.recorded_at), 'HH:mm'),
        in:   r.bytes_in,
        out:  r.bytes_out,
      })));
    } catch {}
    finally { setLoading(false); }
  }, [vmName, hours]);

  useEffect(() => { fetch(); }, [fetch]);

  const hasData = data.some(d => d.in > 0 || d.out > 0);

  return (
    <div className="bg-[#0f1318] border border-slate-800 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-xs font-mono text-slate-400 uppercase tracking-wider">
          <Activity size={11} /> Network Traffic
        </div>
        <div className="flex items-center gap-2">
          {[6, 24, 48, 168].map(h => (
            <button key={h}
              onClick={() => setHours(h)}
              className={`text-[10px] font-mono px-2 py-0.5 rounded transition-all
                ${hours === h ? 'bg-blue-500/20 text-blue-400' : 'text-slate-600 hover:text-slate-400'}`}>
              {h < 24 ? `${h}h` : h === 168 ? '7d' : `${h / 24}d`}
            </button>
          ))}
          <button onClick={fetch} className="text-slate-600 hover:text-slate-400 ml-1">
            <RefreshCw size={11} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-36 text-slate-600">
          <Loader size={16} className="animate-spin" />
        </div>
      ) : !hasData ? (
        <div className="flex flex-col items-center justify-center h-36 text-slate-700">
          <Activity size={20} className="mb-2" />
          <span className="text-xs font-mono">No traffic data yet</span>
          <span className="text-[10px] font-mono mt-1 text-slate-800">Data is collected every 60 seconds</span>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={140}>
          <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="gradIn" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradOut" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#a855f7" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#475569', fontFamily: 'monospace' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 9, fill: '#475569', fontFamily: 'monospace' }} tickLine={false} axisLine={false} tickFormatter={formatBytes} width={52} />
            <Tooltip content={<CustomTooltip />} />
            <Area type="monotone" dataKey="in"  name="Inbound"  stroke="#3b82f6" fill="url(#gradIn)"  strokeWidth={1.5} dot={false} />
            <Area type="monotone" dataKey="out" name="Outbound" stroke="#a855f7" fill="url(#gradOut)" strokeWidth={1.5} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      )}

      <div className="flex items-center gap-4 mt-2">
        <div className="flex items-center gap-1.5 text-[10px] font-mono text-slate-500">
          <div className="w-2 h-2 rounded-full bg-blue-500" /> Inbound
        </div>
        <div className="flex items-center gap-1.5 text-[10px] font-mono text-slate-500">
          <div className="w-2 h-2 rounded-full bg-purple-500" /> Outbound
        </div>
      </div>
    </div>
  );
}

// ─── ISO Manager panel ───────────────────────────────────────────────────────

export function ISOManager({ vmName, isAdmin }) {
  const [isos, setIsos]       = useState([]);
  const [current, setCurrent] = useState(null);
  const [folder, setFolder]   = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [isoData, dvd] = await Promise.all([
        api.listISOs(),
        api.getVMDvd(vmName),
      ]);
      setIsos(isoData?.isos || []);
      setFolder(isoData?.folder || '');
      const dvdArr = Array.isArray(dvd) ? dvd : (dvd ? [dvd] : []);
      setCurrent(dvdArr[0]?.Path || null);
    } catch {}
    finally { setLoading(false); }
  }, [vmName]);

  useEffect(() => { if (isAdmin) load(); }, [load, isAdmin]);

  if (!isAdmin) return null;

  const handleAttach = async (isoPath) => {
    setBusy(true); setError('');
    try {
      await api.attachISO(vmName, isoPath);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to attach ISO');
    } finally { setBusy(false); }
  };

  const handleDetach = async () => {
    setBusy(true); setError('');
    try {
      await api.detachISO(vmName);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to detach ISO');
    } finally { setBusy(false); }
  };

  return (
    <div className="bg-[#0f1318] border border-slate-800 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-xs font-mono text-slate-400 uppercase tracking-wider">
          <Disc size={11} /> DVD Drive
        </div>
        <button onClick={load} className="text-slate-600 hover:text-slate-400"><RefreshCw size={11} /></button>
      </div>

      {error && <div className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg p-2 mb-3">{error}</div>}

      {loading ? (
        <div className="flex justify-center py-4"><Loader size={14} className="animate-spin text-slate-600" /></div>
      ) : (
        <>
          {/* Current */}
          <div className="bg-[#151a22] rounded-lg p-2.5 mb-3">
            <div className="text-[10px] font-mono text-slate-600 uppercase mb-1">Currently Mounted</div>
            {current ? (
              <div className="flex items-center gap-2">
                <Disc size={11} className="text-blue-400 shrink-0" />
                <span className="text-xs font-mono text-slate-300 truncate flex-1">{current.split('\\').pop()}</span>
                <button onClick={handleDetach} disabled={busy}
                  className="p-1 rounded text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-all">
                  {busy ? <Loader size={10} className="animate-spin" /> : <X size={10} />}
                </button>
              </div>
            ) : (
              <span className="text-xs font-mono text-slate-600">No ISO mounted</span>
            )}
          </div>

          {/* ISO list */}
          {isos.length > 0 && (
            <div className="max-h-40 overflow-y-auto space-y-0.5">
              {isos.map(iso => (
                <button key={iso.FullName}
                  onClick={() => handleAttach(iso.FullName)}
                  disabled={busy || current === iso.FullName}
                  className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-all
                    ${current === iso.FullName
                      ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                      : 'hover:bg-slate-800/50 text-slate-400 hover:text-slate-200'}`}>
                  <Disc size={11} className="shrink-0" />
                  <span className="text-xs font-mono truncate">{iso.Name}</span>
                  {current === iso.FullName && <span className="ml-auto text-[9px] font-mono text-blue-400">mounted</span>}
                </button>
              ))}
            </div>
          )}

          {isos.length === 0 && (
            <div className="text-xs font-mono text-slate-700 text-center py-2">
              No ISOs found in {folder}
            </div>
          )}
        </>
      )}
    </div>
  );
}
