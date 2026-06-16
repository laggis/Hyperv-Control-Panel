import { useEffect, useState } from 'react';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/Toast';
import { Spinner } from '../components/UI';
import { getSettings, setShowAllVMs, setIsoFolder, saveSMTP, saveBranding, saveConsoleSettings, getVmRoots, addVmRoot, deleteVmRoot, getDiscordWhitelist, addDiscordWhitelist, removeDiscordWhitelist, setDiscordWhitelistEnabled } from '../api';
import { Check, Plus, Trash2, FolderPlus, Mail, Server, Disc, Save, Palette, Monitor, ShieldCheck } from 'lucide-react';

function Section({ title, icon: Icon, children }) {
  return (
    <div className="bg-[#0f1318] border border-slate-800 rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <Icon size={13} className="text-slate-500" />
        <h2 className="text-xs font-mono text-slate-500 uppercase tracking-wider">{title}</h2>
      </div>
      {children}
    </div>
  );
}

const inputCls = "w-full bg-[#151a22] border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 font-mono focus:outline-none focus:border-blue-500/60 transition-colors";

export default function SettingsPage() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]       = useState('');
  const [settings, setSettings] = useState({
    show_all_vms: false,
    iso_folder: 'C:\\ISO',
    alert_email_from: '',
    alert_smtp_host: '',
    alert_smtp_port: '587',
    alert_smtp_user: '',
    alert_smtp_pass: '',
    brand_name:      'Hyper-V Panel',
    brand_color:     '#3b82f6',
    brand_logo_url:  '',
    console_url_template: '',
    console_rdp_port: '3389',
    discord_whitelist_enabled: false,
  });
  const [roots, setRoots]     = useState({ env: [], db: [] });
  const [newRoot, setNewRoot] = useState('');
  const [discordWhitelist, setDiscordWhitelist] = useState([]);
  const [newDiscordId, setNewDiscordId] = useState('');
  const [newDiscordNote, setNewDiscordNote] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [s, r, wl] = await Promise.all([getSettings(), getVmRoots(), getDiscordWhitelist()]);
      setSettings(s || settings);
      setRoots(r || { env: [], db: [] });
      setDiscordWhitelist(Array.isArray(wl) ? wl : []);
    } catch { toast.error('Failed to load settings'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handleToggleShowAll = async (val) => {
    setBusy('show_all');
    try {
      await setShowAllVMs(val);
      setSettings(s => ({ ...s, show_all_vms: val }));
      toast.success(`Show all VMs ${val ? 'enabled' : 'disabled'}`);
    } catch { toast.error('Update failed'); }
    finally { setBusy(''); }
  };

  const handleSaveIsoFolder = async () => {
    setBusy('iso');
    try {
      await setIsoFolder(settings.iso_folder);
      toast.success('ISO folder saved');
    } catch { toast.error('Save failed'); }
    finally { setBusy(''); }
  };

  const handleSaveSMTP = async () => {
    setBusy('smtp');
    try {
      await saveSMTP({
        host: settings.alert_smtp_host,
        port: settings.alert_smtp_port,
        user: settings.alert_smtp_user,
        pass: settings.alert_smtp_pass,
        from: settings.alert_email_from,
      });
      toast.success('SMTP settings saved');
    } catch { toast.error('Save failed'); }
    finally { setBusy(''); }
  };

  const handleSaveBranding = async () => {
    setBusy('branding');
    try {
      await saveBranding({
        brand_name:     settings.brand_name,
        brand_color:    settings.brand_color,
        brand_logo_url: settings.brand_logo_url,
      });
      toast.success('Branding saved');
    } catch { toast.error('Save failed'); }
    finally { setBusy(''); }
  };


  const handleSaveConsole = async () => {
    setBusy('console');
    try {
      await saveConsoleSettings({
        url_template: settings.console_url_template,
        rdp_port: settings.console_rdp_port,
      });
      toast.success('Browser RDP settings saved');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Save failed');
    } finally { setBusy(''); }
  };

  const handleToggleDiscordWhitelist = async (val) => {
    setBusy('discord-toggle');
    try {
      await setDiscordWhitelistEnabled(val);
      setSettings(s => ({ ...s, discord_whitelist_enabled: val }));
      toast.success(`Discord whitelist ${val ? 'enabled' : 'disabled'}`);
    } catch { toast.error('Update failed'); }
    finally { setBusy(''); }
  };

  const handleAddDiscord = async () => {
    const discordId = newDiscordId.trim();
    if (!/^\d{17,20}$/.test(discordId)) {
      toast.error('Enter a valid Discord user ID');
      return;
    }
    setBusy('discord-add');
    try {
      await addDiscordWhitelist(discordId, newDiscordNote.trim());
      setNewDiscordId('');
      setNewDiscordNote('');
      const wl = await getDiscordWhitelist();
      setDiscordWhitelist(Array.isArray(wl) ? wl : []);
      toast.success('Discord ID added to whitelist');
    } catch { toast.error('Add failed'); }
    finally { setBusy(''); }
  };

  const handleRemoveDiscord = async (discordId) => {
    setBusy(`discord-rm-${discordId}`);
    try {
      await removeDiscordWhitelist(discordId);
      setDiscordWhitelist(list => list.filter(i => i.discord_id !== discordId));
      toast.success('Discord ID removed');
    } catch { toast.error('Remove failed'); }
    finally { setBusy(''); }
  };

  const addRoot = async () => {
    const p = newRoot.trim();
    if (!p) return;
    setBusy('root-add');
    try {
      await addVmRoot(p);
      setNewRoot('');
      await load();
      toast.success('Root added');
    } catch (e) { toast.error(e.response?.data?.error || 'Add failed'); }
    finally { setBusy(''); }
  };

  const removeRoot = async (id) => {
    setBusy(`root-${id}`);
    try {
      await deleteVmRoot(id);
      await load();
      toast.success('Root removed');
    } catch { toast.error('Remove failed'); }
    finally { setBusy(''); }
  };

  const set = f => e => setSettings(s => ({ ...s, [f]: typeof e === 'object' ? e.target.value : e }));

  if (loading) return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-center py-20"><Spinner /></div>
    </div>
  );

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <ToastContainer toasts={toast.toasts} removeToast={toast.removeToast} />
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-100">Settings</h1>
        <p className="text-sm text-slate-500 mt-0.5">Admin configuration</p>
      </div>

      <div className="grid gap-4">
        {/* VM Visibility */}
        <Section title="VM Visibility" icon={Server}>
          <label className="flex items-center gap-3 cursor-pointer">
            <div onClick={() => handleToggleShowAll(!settings.show_all_vms)}
              className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer
                ${settings.show_all_vms ? 'bg-blue-600' : 'bg-slate-700'}`}>
              <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform
                ${settings.show_all_vms ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </div>
            <div>
              <div className="text-sm text-slate-200 font-mono">Show all VMs</div>
              <div className="text-[11px] text-slate-600 font-mono">Bypass root path filtering and list every VM on the host</div>
            </div>
          </label>
        </Section>

        {/* VM Roots */}
        <Section title="VM Root Paths" icon={FolderPlus}>
          <div className="grid grid-cols-2 gap-4 mb-3">
            <div>
              <div className="text-[10px] font-mono text-slate-600 uppercase mb-2">From .env</div>
              {roots.env.length === 0
                ? <div className="text-xs text-slate-700 font-mono">None configured</div>
                : roots.env.map((p, i) => (
                    <div key={i} className="flex items-center bg-[#0b0f14] border border-slate-800 rounded-lg px-3 py-2 mb-1.5">
                      <span className="text-xs font-mono text-slate-500 truncate">{p}</span>
                    </div>
                  ))}
            </div>
            <div>
              <div className="text-[10px] font-mono text-slate-600 uppercase mb-2">Custom</div>
              {roots.db.length === 0
                ? <div className="text-xs text-slate-700 font-mono">None added</div>
                : roots.db.map(r => (
                    <div key={r.id} className="flex items-center justify-between bg-[#0b0f14] border border-slate-800 rounded-lg px-3 py-2 mb-1.5">
                      <span className="text-xs font-mono text-slate-400 truncate">{r.path}</span>
                      <button onClick={() => removeRoot(r.id)} disabled={busy === `root-${r.id}`}
                        className="ml-2 p-1 text-slate-600 hover:text-red-400 transition-colors shrink-0">
                        <Trash2 size={11} />
                      </button>
                    </div>
                  ))}
            </div>
          </div>
          <div className="flex gap-2">
            <input value={newRoot} onChange={e => setNewRoot(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addRoot()}
              placeholder="Add path (e.g. E:\VMs)"
              className={inputCls} />
            <button onClick={addRoot} disabled={busy === 'root-add'}
              className="px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-all shrink-0">
              <Plus size={13} />
            </button>
          </div>
        </Section>

        {/* ISO Library */}
        <Section title="ISO Library" icon={Disc}>
          <p className="text-xs text-slate-500 mb-3">
            Directory on the Hyper-V host where .iso files are stored. Used by the ISO manager on each VM detail page.
          </p>
          <div className="flex gap-2">
            <input value={settings.iso_folder} onChange={set('iso_folder')}
              placeholder="C:\ISO" className={inputCls} />
            <button onClick={handleSaveIsoFolder} disabled={busy === 'iso'}
              className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-mono rounded-lg transition-all shrink-0">
              {busy === 'iso' ? <span className="animate-spin">⟳</span> : <Save size={13} />}
              Save
            </button>
          </div>
        </Section>

        {/* Branding */}
        <Section title="Branding" icon={Palette}>
          <p className="text-xs text-slate-500 mb-4">
            Customise the panel name, accent colour, and logo shown in the sidebar and login page.
          </p>
          <div className="space-y-3 mb-3">
            <div>
              <label className="block text-[10px] font-mono text-slate-500 uppercase mb-1">Panel Name</label>
              <input value={settings.brand_name} onChange={set('brand_name')}
                placeholder="Hyper-V Panel" className={inputCls} />
            </div>
            <div>
              <label className="block text-[10px] font-mono text-slate-500 uppercase mb-1">Logo URL (optional)</label>
              <input value={settings.brand_logo_url} onChange={set('brand_logo_url')}
                placeholder="https://example.com/logo.png" className={inputCls} />
            </div>
            <div>
              <label className="block text-[10px] font-mono text-slate-500 uppercase mb-1">Accent Colour</label>
              <div className="flex items-center gap-3">
                <input type="color" value={settings.brand_color}
                  onChange={e => setSettings(s => ({ ...s, brand_color: e.target.value }))}
                  className="w-10 h-10 rounded-lg border border-slate-700 bg-transparent cursor-pointer p-0.5" />
                <input value={settings.brand_color} onChange={set('brand_color')}
                  placeholder="#3b82f6" className={`${inputCls} flex-1`} />
                <div className="w-8 h-8 rounded-lg border border-slate-700 shrink-0"
                  style={{ backgroundColor: settings.brand_color }} />
              </div>
            </div>
          </div>
          {settings.brand_logo_url && (
            <div className="flex items-center gap-3 bg-[#151a22] border border-slate-800 rounded-xl p-3 mb-3">
              <img src={settings.brand_logo_url} alt="Logo preview" className="h-8 object-contain rounded"
                onError={e => { e.target.style.display = 'none'; }} />
              <span className="text-xs text-slate-500 font-mono">Logo preview</span>
            </div>
          )}
          <div className="flex justify-end">
            <button onClick={handleSaveBranding} disabled={busy === 'branding'}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-mono rounded-lg transition-all">
              {busy === 'branding' ? <span className="animate-spin">⟳</span> : <Save size={13} />}
              Save Branding
            </button>
          </div>
        </Section>

        {/* Browser Console (RDP) */}
        <Section title="Remote Desktop Settings" icon={Monitor}>
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 mb-4">
            <div className="text-xs font-mono text-blue-300 mb-1">Built-in browser console</div>
            <p className="text-xs text-slate-500 leading-relaxed">
              VMs open directly in the panel via a pure Node.js WebSocket console — no external gateway required.
              Hyper-V console uses host port <strong className="text-slate-400">2179</strong> with the VM GUID.
            </p>
          </div>
          <p className="text-xs text-slate-500 mb-4 leading-relaxed">
            Optional: an external HTML5 RDP gateway URL template for iframe-based access.
          </p>
          
          <div className="space-y-4 mb-4">
            <div>
              <label className="block text-[10px] font-mono text-slate-500 uppercase mb-2">RDP Gateway URL Template</label>
              <input
                value={settings.console_url_template}
                onChange={set('console_url_template')}
                placeholder="http://localhost/myrtille/?server={host}&port={port}"
                className={`${inputCls} font-mono text-xs`}
              />
              <div className="mt-2 text-[10px] text-slate-600 font-mono">
                Available placeholders: <span className="text-slate-400">{'{host}'}</span>, <span className="text-slate-400">{'{port}'}</span>, <span className="text-slate-400">{'{vm}'}</span>
              </div>
            </div>
            
            <div className="w-48">
              <label className="block text-[10px] font-mono text-slate-500 uppercase mb-2">Default RDP Port</label>
              <input
                value={settings.console_rdp_port}
                onChange={set('console_rdp_port')}
                placeholder="3389"
                type="number"
                min="1"
                max="65535"
                className={inputCls}
              />
            </div>
          </div>
          
          <div className="flex justify-end mb-4">
            <button onClick={handleSaveConsole} disabled={busy === 'console'}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-mono rounded-lg transition-all">
              {busy === 'console' ? <span className="animate-spin">?</span> : <Save size={13} />}
              Save Settings
            </button>
          </div>
          
          <div className="bg-[#0b0e14] border border-slate-800 rounded-xl p-4">
            <div className="text-slate-400 font-medium mb-3 text-xs font-mono uppercase">Popular Gateways</div>
            <div className="space-y-3">
              <div className="bg-[#151a22] border border-slate-700 rounded-lg p-3">
                <div className="text-xs font-mono text-slate-300 mb-1">Myrtille (Recommended)</div>
                <div className="text-[10px] text-slate-500 font-mono mb-2">Open-source web RDP gateway for Windows</div>
                <div className="text-[10px] text-slate-400 font-mono bg-[#0f1318] rounded px-2 py-1 border border-slate-800">
                  http://localhost/myrtille/?server={'{host}'}&port={'{port}'}
                </div>
              </div>
              
            </div>
            
            <div className="mt-3 pt-3 border-t border-slate-800">
              <div className="text-[10px] text-slate-600 font-mono">
                <strong>Setup:</strong> Install your chosen gateway, then configure the URL template above.
                The built-in console does not require any of these gateways.
              </div>
            </div>
          </div>
        </Section>

        {/* Console Access Policy */}
        <Section title="Console Access Policy" icon={ShieldCheck}>
          <label className="flex items-center gap-3 cursor-pointer mb-4">
            <div onClick={() => handleToggleDiscordWhitelist(!settings.discord_whitelist_enabled)}
              className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer
                ${settings.discord_whitelist_enabled ? 'bg-blue-600' : 'bg-slate-700'}`}>
              <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform
                ${settings.discord_whitelist_enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </div>
            <div>
              <div className="text-sm text-slate-200 font-mono">Require Discord whitelist for console sessions</div>
              <div className="text-[11px] text-slate-600 font-mono">Blocks /api/vnc and /api/rdp unless user has a linked and allowed Discord ID</div>
            </div>
          </label>

          <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2 mb-3">
            <input value={newDiscordId} onChange={e => setNewDiscordId(e.target.value)}
              placeholder="Discord user ID (17-20 digits)" className={inputCls} />
            <input value={newDiscordNote} onChange={e => setNewDiscordNote(e.target.value)}
              placeholder="Note (optional)" className={inputCls} />
            <button onClick={handleAddDiscord} disabled={busy === 'discord-add'}
              className="px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-all shrink-0">
              <Plus size={13} />
            </button>
          </div>

          <div className="space-y-1.5">
            {discordWhitelist.length === 0 ? (
              <div className="text-xs text-slate-700 font-mono">No Discord IDs in whitelist</div>
            ) : (
              discordWhitelist.map(item => (
                <div key={item.discord_id} className="flex items-center justify-between bg-[#0b0f14] border border-slate-800 rounded-lg px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-xs font-mono text-slate-300 truncate">{item.discord_id}</div>
                    {item.note && <div className="text-[10px] text-slate-600 truncate">{item.note}</div>}
                  </div>
                  <button onClick={() => handleRemoveDiscord(item.discord_id)} disabled={busy === `discord-rm-${item.discord_id}`}
                    className="ml-2 p-1 text-slate-600 hover:text-red-400 transition-colors shrink-0">
                    <Trash2 size={11} />
                  </button>
                </div>
              ))
            )}
          </div>
        </Section>

        {/* SMTP */}
        <Section title="Email Alerts (SMTP)" icon={Mail}>
          <p className="text-xs text-slate-500 mb-4">
            Used by the alert system to send email notifications. Requires <code className="font-mono text-slate-400">nodemailer</code> to be installed (<code className="font-mono text-slate-400">npm install nodemailer</code>).
          </p>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-[10px] font-mono text-slate-500 uppercase mb-1">SMTP Host</label>
              <input value={settings.alert_smtp_host} onChange={set('alert_smtp_host')}
                placeholder="smtp.gmail.com" className={inputCls} />
            </div>
            <div>
              <label className="block text-[10px] font-mono text-slate-500 uppercase mb-1">Port</label>
              <input type="number" value={settings.alert_smtp_port} onChange={set('alert_smtp_port')}
                placeholder="587" className={inputCls} />
            </div>
            <div>
              <label className="block text-[10px] font-mono text-slate-500 uppercase mb-1">Username</label>
              <input value={settings.alert_smtp_user} onChange={set('alert_smtp_user')}
                placeholder="alerts@example.com" className={inputCls} />
            </div>
            <div>
              <label className="block text-[10px] font-mono text-slate-500 uppercase mb-1">Password</label>
              <input type="password" value={settings.alert_smtp_pass} onChange={set('alert_smtp_pass')}
                placeholder="••••••••" className={inputCls} />
            </div>
            <div className="col-span-2">
              <label className="block text-[10px] font-mono text-slate-500 uppercase mb-1">From Address</label>
              <input value={settings.alert_email_from} onChange={set('alert_email_from')}
                placeholder="HyperV Panel <alerts@example.com>" className={inputCls} />
            </div>
          </div>
          <div className="flex justify-end">
            <button onClick={handleSaveSMTP} disabled={busy === 'smtp'}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-mono rounded-lg transition-all">
              {busy === 'smtp' ? <span className="animate-spin">⟳</span> : <Save size={13} />}
              Save SMTP
            </button>
          </div>
        </Section>
      </div>
    </div>
  );
}
