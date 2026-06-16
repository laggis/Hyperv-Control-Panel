import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useToast } from '../hooks/useToast';
import * as api from '../api';
import CanvasConsole from '../components/CanvasConsole';
import {
  ArrowLeft, Monitor, Maximize2, Minimize2,
  Loader, AlertCircle, RefreshCw,
  Wifi, Save, Eye, EyeOff, Check,
  Power, MonitorPlay, SlidersHorizontal
} from 'lucide-react';

export default function ConsolePage() {
  const { name }     = useParams();
  const vmName       = decodeURIComponent(name);
  const navigate     = useNavigate();
  const toast        = useToast();

  const [activeTab, setActiveTab] = useState('console');

  const [state, setState]     = useState('loading'); // loading | ready | error
  const [sessionMode, setSessionMode] = useState('vmconnect');
  const [wsPath, setWsPath] = useState('/api/rdp-console');
  const [consoleKey, setConsoleKey] = useState(0);
  const [vmIP, setVmIP]       = useState('');
  const [rdpHost, setRdpHost] = useState('');
  const [rdpPort, setRdpPort] = useState('');
  const [useManual, setUseManual] = useState(false);
  const [error, setError]     = useState('');
  const [fullscreen, setFullscreen] = useState(false);
  const [reloading, setReloading]   = useState(false);

  const [config, setConfig] = useState({
    rdp_port: '3389',
    rdp_host: '',
    rdp_username: '',
    rdp_password: '',
    use_manual: false,
  });
  const [originalConfig, setOriginalConfig] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [hasPassword, setHasPassword] = useState(false);

  const containerRef = useRef(null);

  const handleConsoleError = useCallback((msg) => {
    setError(msg);
    setState('error');
  }, []);

  const loadConsole = async () => {
    setState('loading');
    setError('');
    try {
      const data = await api.getVMConsoleSession(vmName);
      setSessionMode(data.mode || 'vmconnect');
      setWsPath(data.ws_path || '/api/rdp-console');
      setUseManual(!!data.use_manual);
      setRdpHost(data.rdp_host || '');
      setRdpPort(data.port || '');
      setConsoleKey((k) => k + 1);
      setState('ready');
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      setState('error');
    }
  };

  const loadConfig = async () => {
    setLoadingConfig(true);
    try {
      const data = await api.getVMConsoleConfig(vmName);
      const configData = {
        rdp_port: data.rdp_port || '3389',
        rdp_host: data.rdp_host || '',
        rdp_username: data.rdp_username || '',
        rdp_password: '',
        use_manual: data.use_manual || false,
      };
      setConfig(configData);
      setOriginalConfig(configData);
      setHasPassword(!!data.rdp_password && data.rdp_password === '[ENCRYPTED]');
      setVmIP(data.auto_ip || '');
    } catch {
      toast.error('Failed to load console configuration');
    } finally {
      setLoadingConfig(false);
    }
  };

  useEffect(() => {
    loadConsole();
    loadConfig();
  }, [vmName]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
      setFullscreen(true);
    } else {
      document.exitFullscreen();
      setFullscreen(false);
    }
  };

  useEffect(() => {
    const h = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', h);
    return () => document.removeEventListener('fullscreenchange', h);
  }, []);

  const handleReload = () => {
    setReloading(true);
    loadConsole().finally(() => setTimeout(() => setReloading(false), 600));
  };

  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      const payload = {
        rdp_port: config.rdp_port,
        rdp_host: config.rdp_host,
        rdp_username: config.rdp_username,
        use_manual: config.use_manual,
      };
      if (config.rdp_password && config.rdp_password !== '[ENCRYPTED]') {
        payload.rdp_password = config.rdp_password;
      }

      await api.setVMConsoleConfig(vmName, payload);
      toast.success('Console settings saved');
      setOriginalConfig({ ...config, rdp_password: '' });
      setHasPassword(!!config.rdp_password || hasPassword);

      await loadConsole();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const hasChanges = JSON.stringify(config) !== JSON.stringify(originalConfig);

  const inputCls = "w-full bg-[#151a22] border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 font-mono focus:outline-none focus:border-blue-500/60 transition-colors";

  return (
    <div
      ref={containerRef}
      className={`flex flex-col bg-[#0b0e14] ${fullscreen ? 'h-screen' : 'min-h-screen'}`}
    >
      <div className={`flex items-center gap-3 px-4 py-2.5 border-b border-slate-800 bg-[#0b0e14] shrink-0 z-10
        ${fullscreen ? 'absolute top-0 left-0 right-0 opacity-0 hover:opacity-100 transition-opacity duration-200' : ''}`}>

        <button
          onClick={() => navigate(`/vms/${encodeURIComponent(vmName)}`)}
          className="p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-all"
        >
          <ArrowLeft size={15} />
        </button>

        <Monitor size={14} className="text-blue-400 shrink-0" />
        <span className="text-sm font-mono font-medium text-slate-200">{vmName}</span>
        <span className="text-slate-700 text-xs font-mono">console</span>

        {state === 'ready' && (
          <span className="text-[10px] font-mono text-slate-600 flex items-center gap-1 ml-2">
            {sessionMode === 'vmconnect' ? (
              <>
                <Wifi size={9} className="text-green-400" />
                Hyper-V console
              </>
            ) : (
              <>
                <Wifi size={9} className="text-yellow-400" />
                RDP {rdpHost}:{rdpPort}
              </>
            )}
          </span>
        )}

        <div className="flex-1" />

        {!fullscreen && (
          <div className="flex items-center gap-1 bg-[#151a22] rounded-lg p-0.5 mr-2">
            <button
              onClick={() => setActiveTab('console')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-mono transition-all ${
                activeTab === 'console'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <MonitorPlay size={12} /> Console
            </button>
            <button
              onClick={() => setActiveTab('settings')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-mono transition-all ${
                activeTab === 'settings'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <SlidersHorizontal size={12} /> Settings
            </button>
          </div>
        )}

        {activeTab === 'console' && state === 'ready' && (
          <>
            <button
              onClick={handleReload}
              disabled={reloading}
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-all"
              title="Reload console"
            >
              <RefreshCw size={13} className={reloading ? 'animate-spin' : ''} />
            </button>

            <button
              onClick={toggleFullscreen}
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-all"
            >
              {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </button>
          </>
        )}
      </div>

      <div className="flex-1 relative overflow-hidden">
        {(activeTab === 'console' || fullscreen) && (
          <div className="absolute inset-0 bg-black">
            {state === 'loading' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                <Loader size={26} className="animate-spin text-blue-400" />
                <div className="text-slate-400 font-mono text-sm">Connecting to console...</div>
              </div>
            )}

            {state === 'error' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
                <AlertCircle size={32} className="text-red-400" />
                <div className="text-red-300 font-mono text-sm text-center max-w-sm px-4">{error}</div>
                <div className="flex gap-2">
                  <button
                    onClick={loadConsole}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-mono rounded-lg transition-all"
                  >
                    <RefreshCw size={13} /> Retry
                  </button>
                  <button
                    onClick={() => setActiveTab('settings')}
                    className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm font-mono rounded-lg transition-all"
                  >
                    <SlidersHorizontal size={13} /> Check Settings
                  </button>
                </div>
              </div>
            )}

            {state === 'ready' && (
              <CanvasConsole
                key={consoleKey}
                vmName={vmName}
                wsPath={wsPath}
                onError={handleConsoleError}
              />
            )}
          </div>
        )}

        {activeTab === 'settings' && !fullscreen && (
          <div className="absolute inset-0 overflow-auto p-6">
            <div className="max-w-2xl mx-auto">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                  <SlidersHorizontal size={18} className="text-blue-400" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-slate-200">Remote Desktop Settings</h2>
                  <p className="text-xs text-slate-500 font-mono">{vmName}</p>
                </div>
              </div>

              {loadingConfig ? (
                <div className="flex items-center justify-center py-12">
                  <Loader size={24} className="animate-spin text-blue-400" />
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="bg-[#0f1318] border border-slate-800 rounded-2xl p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <Power size={13} className="text-slate-500" />
                      <h3 className="text-xs font-mono text-slate-500 uppercase tracking-wider">Connection Mode</h3>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => setConfig(c => ({ ...c, use_manual: false }))}
                        className={`p-4 rounded-xl border transition-all text-left ${
                          !config.use_manual
                            ? 'bg-blue-500/10 border-blue-500/30'
                            : 'bg-[#151a22] border-slate-700 hover:border-slate-600'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          {!config.use_manual && <Check size={14} className="text-blue-400" />}
                          <span className={`text-sm font-medium ${!config.use_manual ? 'text-blue-300' : 'text-slate-300'}`}>
                            Auto-Detect
                          </span>
                        </div>
                        <p className="text-xs text-slate-500">
                          Hyper-V VM console (no agent, uses host port 2179)
                        </p>
                      </button>

                      <button
                        onClick={() => setConfig(c => ({ ...c, use_manual: true }))}
                        className={`p-4 rounded-xl border transition-all text-left ${
                          config.use_manual
                            ? 'bg-blue-500/10 border-blue-500/30'
                            : 'bg-[#151a22] border-slate-700 hover:border-slate-600'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          {config.use_manual && <Check size={14} className="text-blue-400" />}
                          <span className={`text-sm font-medium ${config.use_manual ? 'text-blue-300' : 'text-slate-300'}`}>
                            Manual
                          </span>
                        </div>
                        <p className="text-xs text-slate-500">
                          Standard RDP to a custom IP/hostname and port
                        </p>
                      </button>
                    </div>
                  </div>

                  <div className="bg-[#0f1318] border border-slate-800 rounded-2xl p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <Monitor size={13} className="text-slate-500" />
                      <h3 className="text-xs font-mono text-slate-500 uppercase tracking-wider">RDP Configuration</h3>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <label className="block text-[11px] font-mono text-slate-500 uppercase mb-2">
                          {config.use_manual ? 'Host / IP Address *' : 'Host / IP Address (auto-detected)'}
                        </label>
                        <input
                          type="text"
                          value={config.rdp_host}
                          onChange={(e) => setConfig(c => ({ ...c, rdp_host: e.target.value }))}
                          placeholder={config.use_manual ? "e.g., 192.168.1.100" : "Leave empty to auto-detect"}
                          disabled={!config.use_manual}
                          className={`${inputCls} ${!config.use_manual ? 'opacity-60 cursor-not-allowed' : ''}`}
                        />
                        {!config.use_manual && (
                          <p className="mt-1.5 text-[10px] text-slate-600 font-mono">
                            Auto-detected IP: {vmIP || 'Not available'}
                          </p>
                        )}
                      </div>

                      <div className="w-40">
                        <label className="block text-[11px] font-mono text-slate-500 uppercase mb-2">
                          RDP Port
                        </label>
                        <input
                          type="number"
                          value={config.rdp_port}
                          onChange={(e) => setConfig(c => ({ ...c, rdp_port: e.target.value }))}
                          placeholder="3389"
                          min="1"
                          max="65535"
                          className={inputCls}
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-mono text-slate-500 uppercase mb-2">
                          Username
                        </label>
                        <input
                          type="text"
                          value={config.rdp_username}
                          onChange={(e) => setConfig(c => ({ ...c, rdp_username: e.target.value }))}
                          placeholder="Administrator"
                          className={inputCls}
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-mono text-slate-500 uppercase mb-2">
                          Password {hasPassword && !config.rdp_password && '(saved - enter to change)'}
                        </label>
                        <div className="relative">
                          <input
                            type={showPassword ? 'text' : 'password'}
                            value={config.rdp_password}
                            onChange={(e) => setConfig(c => ({ ...c, rdp_password: e.target.value }))}
                            placeholder={hasPassword ? '••••••••' : 'Optional - for auto-login'}
                            className={`${inputCls} pr-10`}
                          />
                          <button
                            onClick={() => setShowPassword(v => !v)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                          >
                            {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-[#0f1318] border border-slate-800 rounded-2xl p-5">
                    <h3 className="text-xs font-mono text-slate-500 uppercase tracking-wider mb-3">
                      Quick Tips
                    </h3>
                    <ul className="space-y-2 text-xs text-slate-500">
                      <li className="flex gap-2">
                        <span className="text-blue-400">•</span>
                        <strong className="text-slate-400">Auto-Detect</strong> opens the built-in Hyper-V console — nothing to install on the VM
                      </li>
                      <li className="flex gap-2">
                        <span className="text-blue-400">•</span>
                        <strong className="text-slate-400">Manual</strong> connects with normal RDP (e.g. public IP + port 3389); RDP must be enabled on the VM
                      </li>
                      <li className="flex gap-2">
                        <span className="text-blue-400">•</span>
                        Username/password are optional for Hyper-V console; required for most manual RDP targets
                      </li>
                      <li className="flex gap-2">
                        <span className="text-blue-400">•</span>
                        The built-in console runs entirely in Node.js — no external gateway required
                      </li>
                    </ul>
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <div className="text-xs text-slate-600 font-mono">
                      {hasChanges ? (
                        <span className="text-yellow-400">Unsaved changes</span>
                      ) : (
                        <span className="flex items-center gap-1 text-green-400">
                          <Check size={12} /> Saved
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setConfig(originalConfig);
                          setShowPassword(false);
                        }}
                        disabled={!hasChanges || saving}
                        className="px-4 py-2 text-sm font-mono text-slate-400 hover:text-slate-200 transition-all disabled:opacity-50"
                      >
                        Reset
                      </button>
                      <button
                        onClick={handleSaveSettings}
                        disabled={!hasChanges || saving || (config.use_manual && !config.rdp_host)}
                        className="flex items-center gap-1.5 px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:opacity-50 text-white text-sm font-mono rounded-lg transition-all"
                      >
                        {saving ? (
                          <>
                            <Loader size={13} className="animate-spin" /> Saving...
                          </>
                        ) : (
                          <>
                            <Save size={13} /> Save Settings
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
