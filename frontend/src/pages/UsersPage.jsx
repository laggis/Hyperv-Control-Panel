import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/Toast';
import { Badge, Spinner } from '../components/UI';
import * as api from '../api';
import {
  Users, Plus, Trash2, X, UserPlus, Loader, Shield,
  AlertCircle, Check, Server, Key
} from 'lucide-react';
import { format } from 'date-fns';

function ChangePasswordModal({ user, onClose, onDone }) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleChange = async () => {
    if (!newPassword) return setError('Password is required');
    if (newPassword.length < 8) return setError('Password must be at least 8 characters');
    if (newPassword !== confirmPassword) return setError('Passwords do not match');
    
    setLoading(true);
    setError('');
    try {
      await api.changePassword(user.id, newPassword);
      onDone(`Password changed for "${user.username}"`);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to change password');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#151a22] border border-slate-700 rounded-2xl p-5 w-full max-w-sm shadow-2xl animate-slide-up mx-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Key size={16} className="text-yellow-400" />
            <h3 className="font-semibold text-slate-100 text-sm">Change Password</h3>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300"><X size={16} /></button>
        </div>

        {error && (
          <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-lg p-2.5 mb-3 text-sm text-red-300">
            <AlertCircle size={13} /> {error}
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-mono text-slate-400 mb-1 uppercase">User</label>
            <div className="bg-[#0f1318] border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 font-mono">
              {user.username}
            </div>
          </div>

          <div>
            <label className="block text-xs font-mono text-slate-400 mb-1 uppercase">New Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && newPassword && confirmPassword) handleChange(); }}
              placeholder="Minimum 8 characters"
              className="w-full bg-[#0f1318] border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200
                font-mono focus:outline-none focus:border-yellow-500/60"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-mono text-slate-400 mb-1 uppercase">Confirm Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && newPassword && confirmPassword) handleChange(); }}
              placeholder="Re-enter password"
              className="w-full bg-[#0f1318] border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200
                font-mono focus:outline-none focus:border-yellow-500/60"
            />
          </div>

          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-2.5 text-xs text-yellow-300">
            <div className="flex items-start gap-2">
              <AlertCircle size={12} className="mt-0.5 shrink-0" />
              <div>User will need to log in again with the new password.</div>
            </div>
          </div>
        </div>

        <div className="flex gap-2 justify-end mt-4">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-all">
            Cancel
          </button>
          <button
            onClick={handleChange}
            disabled={loading || !newPassword || !confirmPassword}
            className="px-3 py-1.5 text-sm font-medium text-white bg-yellow-600 hover:bg-yellow-500 rounded-lg transition-all flex items-center gap-1.5 disabled:opacity-60"
          >
            {loading ? <Loader size={12} className="animate-spin" /> : <Key size={12} />}
            Change Password
          </button>
        </div>
      </div>
    </div>
  );
}

function ManageAccessModal({ user, onClose, onDone }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [allVMs, setAllVMs] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [error, setError] = useState('');
  const [manualName, setManualName] = useState('');

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [vms, assigned] = await Promise.all([api.listVMs(), api.listUserVMs(user.id)]);
        setAllVMs(vms || []);
        setSelected(new Set(assigned || []));
      } catch (err) {
        setError(err.response?.data?.error || 'Failed to load data');
      } finally {
        setLoading(false);
      }
    })();
  }, [user.id]);

  const toggle = (vmName) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(vmName)) next.delete(vmName); else next.add(vmName);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const current = new Set(await api.listUserVMs(user.id));
      const desired = selected;
      const toAdd = [...desired].filter(n => !current.has(n));
      const toRemove = [...current].filter(n => !desired.has(n));
      await Promise.all([
        ...toAdd.map(n => api.assignUserVM(user.id, n)),
        ...toRemove.map(n => api.unassignUserVM(user.id, n)),
      ]);
      onDone('Access updated');
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed');
      setSaving(false);
    }
  };

  const addManual = () => {
    const name = manualName.trim();
    if (!name) return;
    setSelected(prev => new Set(prev).add(name));
    setManualName('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#151a22] border border-slate-700 rounded-2xl p-5 w-full max-w-xl shadow-2xl animate-slide-up mx-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Server size={16} className="text-blue-400" />
            <h3 className="font-semibold text-slate-100 text-sm">VM Access for {user.username}</h3>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300"><X size={16} /></button>
        </div>
        {error && (
          <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-lg p-2.5 mb-3 text-sm text-red-300">
            <AlertCircle size={13} /> {error}
          </div>
        )}
        {loading ? (
          <div className="flex items-center justify-center py-10"><Spinner /></div>
        ) : (
          <>
            <div className="mb-3">
              <label className="block text-xs font-mono text-slate-400 mb-1 uppercase">Add by VM name</label>
              <div className="flex gap-2">
                <input
                  value={manualName}
                  onChange={e => setManualName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addManual(); } }}
                  placeholder="Type exact VM name and press Enter"
                  className="flex-1 bg-[#0f1318] border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 font-mono focus:outline-none focus:border-blue-500/60"
                />
                <button onClick={addManual} className="px-3 py-2 text-sm font-mono bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-200">
                  Add
                </button>
              </div>
            </div>
            <div className="max-h-80 overflow-auto border border-slate-800 rounded-lg">
              {allVMs.map(v => (
                <label key={v.Name} className="flex items-center gap-2 px-3 py-2 border-b border-slate-800/60 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.has(v.Name)}
                    onChange={() => toggle(v.Name)}
                  />
                  <span className="font-mono text-slate-200">{v.Name}</span>
                  <span className="text-[11px] font-mono text-slate-500 ml-auto">{v.State}</span>
                </label>
              ))}
              {allVMs.length === 0 && (
                <div className="py-8 text-center text-slate-500 text-sm">No VMs found</div>
              )}
            </div>
          </>
        )}
        <div className="flex gap-2 justify-end mt-4">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-all">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-all flex items-center gap-1.5 disabled:opacity-60"
          >
            {saving ? <Loader size={12} className="animate-spin" /> : <Check size={12} />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
function CreateUserModal({ onDone, onClose }) {
  const [form, setForm] = useState({ username: '', password: '', role: 'user' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [vms, setVMs] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [manualName, setManualName] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const list = await api.listVMs();
        setVMs(list || []);
      } catch {}
    })();
  }, []);

  const handleCreate = async () => {
    if (!form.username || !form.password) return setError('All fields required');
    if (form.password.length < 8) return setError('Password must be at least 8 characters');
    setLoading(true);
    setError('');
    try {
      const u = await api.createUser(form);
      const adds = [...selected].map(n => api.assignUserVM(u.id, n));
      if (adds.length) await Promise.all(adds);
      onDone(`User "${form.username}" created`);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      setLoading(false);
    }
  };

  const addManual = () => {
    const name = manualName.trim();
    if (!name) return;
    setSelected(prev => new Set(prev).add(name));
    setManualName('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#151a22] border border-slate-700 rounded-2xl p-5 w-full max-w-sm shadow-2xl animate-slide-up mx-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <UserPlus size={16} className="text-blue-400" />
            <h3 className="font-semibold text-slate-100 text-sm">Create User</h3>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300"><X size={16} /></button>
        </div>

        {error && (
          <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-lg p-2.5 mb-3 text-sm text-red-300">
            <AlertCircle size={13} /> {error}
          </div>
        )}

        <div className="space-y-3">
          {['username', 'password'].map(field => (
            <div key={field}>
              <label className="block text-xs font-mono text-slate-400 mb-1 uppercase">{field}</label>
              <input
                type={field === 'password' ? 'password' : 'text'}
                value={form[field]}
                onChange={e => setForm(p => ({ ...p, [field]: e.target.value }))}
                className="w-full bg-[#0f1318] border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200
                  font-mono focus:outline-none focus:border-blue-500/60"
              />
            </div>
          ))}

          <div>
            <label className="block text-xs font-mono text-slate-400 mb-1 uppercase">Role</label>
            <select
              value={form.role}
              onChange={e => setForm(p => ({ ...p, role: e.target.value }))}
              className="w-full bg-[#0f1318] border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200
                font-mono focus:outline-none focus:border-blue-500/60"
            >
              <option value="user">User — full access to assigned VMs</option>
              <option value="admin">Admin — full access to everything</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-mono text-slate-400 mb-1 uppercase">Assign VMs (optional)</label>
            <div className="max-h-48 overflow-auto border border-slate-800 rounded-lg">
              {vms.map(v => (
                <label key={v.Name} className="flex items-center gap-2 px-3 py-2 border-b border-slate-800/60 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.has(v.Name)}
                    onChange={() => {
                      setSelected(prev => {
                        const next = new Set(prev);
                        if (next.has(v.Name)) next.delete(v.Name); else next.add(v.Name);
                        return next;
                      });
                    }}
                  />
                  <span className="font-mono text-slate-200">{v.Name}</span>
                  <span className="text-[11px] font-mono text-slate-500 ml-auto">{v.State}</span>
                </label>
              ))}
              {vms.length === 0 && (
                <div className="px-3 py-2 text-sm text-slate-500">No VMs found</div>
              )}
            </div>
            <div className="mt-2 flex gap-2">
              <input
                value={manualName}
                onChange={e => setManualName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addManual(); } }}
                placeholder="Or type a VM name to add"
                className="flex-1 bg-[#0f1318] border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 font-mono focus:outline-none focus:border-blue-500/60"
              />
              <button onClick={addManual} className="px-3 py-2 text-sm font-mono bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-200">
                Add
              </button>
            </div>
          </div>
        </div>

        <div className="flex gap-2 justify-end mt-4">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-all">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={loading}
            className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-all flex items-center gap-1.5 disabled:opacity-60"
          >
            {loading ? <Loader size={12} className="animate-spin" /> : <Check size={12} />}
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

const ROLE_ICON = { admin: Shield, user: Users };
const ROLE_BADGE = { admin: 'admin', user: 'user' };

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const toast = useToast();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [manageUser, setManageUser] = useState(null);
  const [changePasswordUser, setChangePasswordUser] = useState(null);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const data = await api.getUsers();
      setUsers(data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchUsers(); }, []);

  const handleDelete = async (id, username) => {
    setDeletingId(id);
    try {
      await api.deleteUser(id);
      toast.success(`User "${username}" deleted`);
      fetchUsers();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <ToastContainer toasts={toast.toasts} removeToast={toast.removeToast} />
      {showCreate && (
        <CreateUserModal
          onDone={(msg) => { toast.success(msg); setShowCreate(false); fetchUsers(); }}
          onClose={() => setShowCreate(false)}
        />
      )}
      {manageUser && (
        <ManageAccessModal
          user={manageUser}
          onClose={() => setManageUser(null)}
          onDone={(msg) => { toast.success(msg); setManageUser(null); }}
        />
      )}
      {changePasswordUser && (
        <ChangePasswordModal
          user={changePasswordUser}
          onClose={() => setChangePasswordUser(null)}
          onDone={(msg) => { toast.success(msg); setChangePasswordUser(null); }}
        />
      )}

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Users</h1>
          <p className="text-sm text-slate-500 mt-0.5">Manage panel access and roles</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium
            bg-blue-600 hover:bg-blue-500 text-white transition-all btn-glow"
        >
          <Plus size={14} />
          New User
        </button>
      </div>

      <div className="bg-[#0f1318] border border-slate-800 rounded-2xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16"><Spinner /></div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] font-mono text-slate-600 uppercase tracking-wider border-b border-slate-800">
                <th className="text-left px-5 py-2.5">User</th>
                <th className="text-left px-4 py-2.5">Role</th>
                <th className="text-left px-4 py-2.5">Created</th>
                <th className="text-left px-4 py-2.5">Last Login</th>
                <th className="px-4 py-2.5 w-40">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => {
                const RoleIcon = ROLE_ICON[u.role] || Settings;
                const isSelf = u.id === currentUser?.id;
                return (
                  <tr key={u.id} className="border-b border-slate-800/40 hover:bg-slate-800/15">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-blue-500/15 border border-blue-500/20 flex items-center justify-center text-xs font-bold text-blue-400 uppercase">
                          {u.username[0]}
                        </div>
                        <div>
                          <div className="font-mono text-slate-200 text-sm">{u.username}</div>
                          {isSelf && <div className="text-[10px] text-blue-400 font-mono">you</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <RoleIcon size={11} className="text-slate-500" />
                        <select
                          value={u.role}
                          disabled={isSelf}
                          onChange={async (e) => {
                            const newRole = e.target.value;
                            try {
                              await api.updateUserRole(u.id, newRole);
                              toast.success(`Role updated to ${newRole}`);
                              setUsers(prev => prev.map(x => x.id === u.id ? { ...x, role: newRole } : x));
                            } catch (err) {
                              toast.error(err.response?.data?.error || 'Update failed');
                            }
                          }}
                          className="bg-[#0f1318] border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-200 font-mono focus:outline-none focus:border-blue-500/60"
                        >
                          <option value="user">user</option>
                          <option value="admin">admin</option>
                        </select>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-mono text-slate-500">
                        {u.created_at ? format(new Date(u.created_at), 'MMM d, yyyy') : '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-mono text-slate-500">
                        {u.last_login ? format(new Date(u.last_login), 'MMM d · HH:mm') : 'Never'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center gap-2 justify-end">
                        <button
                          onClick={() => setChangePasswordUser(u)}
                          className="px-2 py-1 rounded text-xs font-mono text-yellow-400 border border-yellow-500/30 hover:bg-yellow-500/10 transition-all flex items-center gap-1"
                          title="Change password"
                        >
                          <Key size={11} />
                          Password
                        </button>
                        <button
                          onClick={() => setManageUser(u)}
                          className="px-2 py-1 rounded text-xs font-mono text-slate-300 border border-slate-700 hover:bg-slate-800 transition-all"
                          title="Manage VM access"
                        >
                          Assign VMs
                        </button>
                        {!isSelf && (
                          <button
                            onClick={() => handleDelete(u.id, u.username)}
                            disabled={deletingId === u.id}
                            className="p-1.5 rounded text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-40"
                          >
                            {deletingId === u.id ? <Loader size={13} className="animate-spin" /> : <Trash2 size={13} />}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        {[
          { role: 'admin', icon: Shield, desc: 'Full access — manages users, all VMs, and settings' },
          { role: 'user',  icon: Users,  desc: 'Full control over assigned VMs only' },
        ].map(({ role, icon: Icon, desc }) => (
          <div key={role} className="bg-[#0f1318] border border-slate-800 rounded-xl p-3 flex items-start gap-2.5">
            <Icon size={13} className="text-slate-500 mt-0.5 shrink-0" />
            <div>
              <div className="text-xs font-mono text-slate-300 capitalize">{role}</div>
              <div className="text-[10px] text-slate-600 mt-0.5">{desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
