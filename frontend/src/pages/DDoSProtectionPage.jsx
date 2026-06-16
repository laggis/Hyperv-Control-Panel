import { useState, useEffect } from 'react';
import { Shield, Activity, AlertTriangle, Settings, X, Check } from 'lucide-react';
import * as api from '../api';
import { useToast } from '../hooks/useToast';
import { format } from 'date-fns';

export function DDoSProtectionPage() {
  const [events, setEvents] = useState([]);
  const [stats, setStats] = useState(null);
  const [config, setConfig] = useState({});
  const [loading, setLoading] = useState(true);
  const [showConfig, setShowConfig] = useState(false);
  const toast = useToast();

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  async function loadData() {
    try {
      const [eventsData, statsData, configData] = await Promise.all([
        api.getDDoSEvents({ limit: 50 }),
        api.getDDoSStats(),
        api.getDDoSConfig(),
      ]);
      setEvents(eventsData);
      setStats(statsData);
      setConfig(configData);
    } catch (err) {
      toast.error('Failed to load DDoS data: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  async function saveConfig() {
    try {
      await api.updateDDoSConfig(config);
      toast.success('DDoS configuration updated');
      setShowConfig(false);
    } catch (err) {
      toast.error('Failed to update config: ' + err.message);
    }
  }

  async function cleanupOldEvents() {
    if (!confirm('Delete DDoS events older than 30 days?')) return;
    try {
      const result = await api.cleanupDDoSEvents(30);
      toast.success(`Deleted ${result.deleted} old events`);
      loadData();
    } catch (err) {
      toast.error('Cleanup failed: ' + err.message);
    }
  }

  const severityColors = {
    low: 'bg-blue-500/10 text-blue-400',
    medium: 'bg-yellow-500/10 text-yellow-400',
    high: 'bg-red-500/10 text-red-400',
    critical: 'bg-purple-500/10 text-purple-400',
  };

  const actionLabels = {
    none: 'No action',
    alert_only: 'Alert sent',
    network_disconnected: 'Network disconnected',
    vm_suspended: 'VM suspended',
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-slate-400">Loading DDoS protection data...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-red-500/10 rounded-lg">
            <Shield className="text-red-400" size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">DDoS Protection</h1>
            <p className="text-sm text-slate-400">Monitor and mitigate DDoS attacks</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={cleanupOldEvents} className="px-3 py-2 text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-all">
            Clean Up Old Events
          </button>
          <button onClick={() => setShowConfig(!showConfig)} className="px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-all flex items-center gap-2">
            <Settings size={16} />
            Configure
          </button>
        </div>
      </div>

      {/* Stats Overview */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-slate-400">Last 24 Hours</div>
                <div className="text-3xl font-bold text-white">{stats.last_24h}</div>
              </div>
              <Activity className="text-slate-600" size={32} />
            </div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-slate-400">Last 7 Days</div>
                <div className="text-3xl font-bold text-white">{stats.last_7d}</div>
              </div>
              <AlertTriangle className="text-yellow-500" size={32} />
            </div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
            <div>
              <div className="text-sm text-slate-400 mb-2">By Type</div>
              <div className="space-y-1">
                {stats.by_type.map(t => (
                  <div key={t.detection_type} className="flex justify-between text-sm">
                    <span className="text-slate-400">{t.detection_type}</span>
                    <span className="text-white">{t.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
            <div>
              <div className="text-sm text-slate-400 mb-2">By Severity</div>
              <div className="space-y-1">
                {stats.by_severity.map(s => (
                  <div key={s.severity} className="flex justify-between text-sm">
                    <span className={`px-2 py-0.5 rounded text-xs ${severityColors[s.severity] || 'text-slate-400'}`}>
                      {s.severity}
                    </span>
                    <span className="text-white">{s.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Configuration Panel */}
      {showConfig && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">DDoS Detection Configuration</h2>
            <button onClick={() => setShowConfig(false)} className="text-slate-400 hover:text-white">
              <X size={20} />
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1">Detection Enabled</label>
              <select
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white"
                value={config.ddos_detection_enabled || '1'}
                onChange={(e) => setConfig({ ...config, ddos_detection_enabled: e.target.value })}
              >
                <option value="1">Enabled</option>
                <option value="0">Disabled</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Auto-Suspend VM</label>
              <select
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white"
                value={config.ddos_auto_suspend || '0'}
                onChange={(e) => setConfig({ ...config, ddos_auto_suspend: e.target.value })}
              >
                <option value="0">Disabled</option>
                <option value="1">Enabled</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Auto-Disconnect Network</label>
              <select
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white"
                value={config.ddos_auto_disconnect || '0'}
                onChange={(e) => setConfig({ ...config, ddos_auto_disconnect: e.target.value })}
              >
                <option value="0">Disabled</option>
                <option value="1">Enabled</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Spike Threshold (MB/s)</label>
              <input
                type="number"
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white"
                value={config.ddos_outbound_threshold_mbps || '50'}
                onChange={(e) => setConfig({ ...config, ddos_outbound_threshold_mbps: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Sustained Threshold (MB/s)</label>
              <input
                type="number"
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white"
                value={config.ddos_sustained_threshold_mbps || '30'}
                onChange={(e) => setConfig({ ...config, ddos_sustained_threshold_mbps: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Alert Email</label>
              <input
                type="email"
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white"
                placeholder="admin@example.com"
                value={config.ddos_alert_email || ''}
                onChange={(e) => setConfig({ ...config, ddos_alert_email: e.target.value })}
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm text-slate-400 mb-1">Alert Webhook URL</label>
              <input
                type="url"
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white"
                placeholder="https://hooks.slack.com/..."
                value={config.ddos_alert_webhook || ''}
                onChange={(e) => setConfig({ ...config, ddos_alert_webhook: e.target.value })}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setShowConfig(false)} className="px-3 py-2 text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-all">
              Cancel
            </button>
            <button onClick={saveConfig} className="px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-all flex items-center gap-2">
              <Check size={16} />
              Save Configuration
            </button>
          </div>
        </div>
      )}

      {/* Events Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Recent DDoS Events</h2>
        {events.length === 0 ? (
          <div className="text-center py-8 text-slate-400">
            No DDoS events detected yet. Protection is active.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="text-left py-3 px-4 text-sm text-slate-400 font-medium">Timestamp</th>
                  <th className="text-left py-3 px-4 text-sm text-slate-400 font-medium">VM Name</th>
                  <th className="text-left py-3 px-4 text-sm text-slate-400 font-medium">Detection Type</th>
                  <th className="text-left py-3 px-4 text-sm text-slate-400 font-medium">Severity</th>
                  <th className="text-left py-3 px-4 text-sm text-slate-400 font-medium">Metrics</th>
                  <th className="text-left py-3 px-4 text-sm text-slate-400 font-medium">Action Taken</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id} className="border-b border-slate-800 hover:bg-slate-800/30">
                    <td className="py-3 px-4 text-sm text-slate-300">
                      {format(new Date(event.created_at), 'MMM dd, HH:mm:ss')}
                    </td>
                    <td className="py-3 px-4 text-sm text-white font-mono">{event.vm_name}</td>
                    <td className="py-3 px-4 text-sm text-slate-300">{event.detection_type}</td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-1 rounded text-xs ${severityColors[event.severity] || 'text-slate-400'}`}>
                        {event.severity}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-sm text-slate-300">
                      {event.metrics && (
                        <div className="space-y-0.5">
                          {event.metrics.current_rate_mbps && (
                            <div>Rate: {event.metrics.current_rate_mbps.toFixed(2)} MB/s</div>
                          )}
                          {event.metrics.avg_rate_mbps && (
                            <div>Avg: {event.metrics.avg_rate_mbps.toFixed(2)} MB/s</div>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-sm text-slate-300">{actionLabels[event.action_taken] || event.action_taken}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
