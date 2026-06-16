import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/Toast';
import { Spinner } from '../components/UI';
import * as api from '../api';
import {
  ShieldCheck, ShieldOff, Smartphone, X, Loader, AlertCircle,
  Monitor, Clock, Trash2, LogOut, RefreshCw, Key, Users, Check
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';

// ─── 2FA Setup Wizard ────────────────────────────────────────────────────────

function TwoFASetup({ onDone, onCancel }) {
  const [step, setStep]     = useState('qr'); // 'qr' | 'verify'
  const [qr, setQr]         = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode]     = useState('');
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [error, setError]   = useState('');

  useEffect(() => {
    (async () => {
      try {
        const data = await api.setup2FA();
        setQr(data.qr);
        setSecret(data.secret);
      } catch (err) {
        setError(err.response?.data?.error || 'Failed to generate 2FA setup');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleVerify = async (e) => {
    e.preventDefault();
    setVerifying(true);
    setError('');
    try {
      await api.verify2FA(code);
      onDone('Two-factor authentication enabled');
    } catch (err) {
      setError(err.response?.data?.error || 'Invalid code');
      setVerifying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#151a22] border border-slate-700 rounded-2xl p-5 w-full max-w-sm shadow-2xl mx-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Smartphone size={16} className="text-blue-400" />
            <h3 className="font-semibold text-slate-100 text-sm">Enable Two-Factor Auth</h3>
          </div>
          <button onClick={onCancel} className="text-slate-500 hover:text-slate-300"><X size={16} /></button>
        </div>

        {error && (
          <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-lg p-2.5 mb-3 text-sm text-red-300">
            <AlertCircle size={13} />{error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-10"><Spinner /></div>
        ) : step === 'qr' ? (
          <>
            <p className="text-xs text-slate-400 mb-3">
              Scan this QR code with <strong className="text-slate-200">Google Authenticator</strong>, Authy, or any TOTP app.
            </p>
            <div className="flex justify-center mb-3">
              <img src={qr} alt="QR Code" className="w-44 h-44 rounded-lg border border-slate-700 bg-white p-1" />
            </div>
            <div className="bg-[#0f1318] border border-slate-800 rounded-lg p-2.5 mb-4">
              <div className="text-[10px] text-slate-500 font-mono mb-1 uppercase">Manual entry key</div>
              <div className="text-xs font-mono text-blue-300 break-all select-all">{secret}</div>
            </div>
            <button
              onClick={() => setStep('verify')}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium py-2.5 rounded-lg transition-all"
            >
              Next — Enter Code →
            </button>
          </>
        ) : (
          <form onSubmit={handleVerify}>
            <p className="text-xs text-slate-400 mb-4">
              Enter the 6-digit code from your authenticator app to confirm setup.
            </p>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
              autoFocus
              className="w-full bg-[#0f1318] border border-slate-700 rounded-lg px-3 py-2.5 text-lg text-slate-200
                font-mono focus:outline-none focus:border-blue-500/60 tracking-[0.5em] text-center mb-4"
            />
            <div className="flex gap-2">
              <button type="button" onClick={() => setStep('qr')}
                className="flex-1 px-3 py-2 text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-all">
                ← Back
              </button>
              <button
                type="submit"
                disabled={verifying || code.length !== 6}
                className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg transition-all flex items-center justify-center gap-1.5"
              >
                {verifying ? <Loader size={13} className="animate-spin" /> : <Check size={13} />}
                Confirm
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ─── Disable 2FA Modal ───────────────────────────────────────────────────────

function Disable2FAModal({ onDone, onCancel }) {
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  const handleDisable = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await api.disable2FA(password);
      onDone('Two-factor authentication disabled');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to disable 2FA');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#151a22] border border-slate-700 rounded-2xl p-5 w-full max-w-sm shadow-2xl mx-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <ShieldOff size={16} className="text-red-400" />
            <h3 className="font-semibold text-slate-100 text-sm">Disable Two-Factor Auth</h3>
          </div>
          <button onClick={onCancel} className="text-slate-500 hover:text-slate-300"><X size={16} /></button>
        </div>
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-2.5 mb-4 text-xs text-red-300">
          Disabling 2FA will make your account less secure. Confirm with your password.
        </div>
        {error && (
          <div className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg p-2 mb-3">{error}</div>
        )}
        <form onSubmit={handleDisable}>
          <label className="block text-xs font-mono text-slate-400 mb-1.5 uppercase">Current Password</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoFocus
            className="w-full bg-[#0f1318] border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 font-mono focus:outline-none focus:border-red-500/60 mb-4"
          />
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={onCancel}
              className="px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-all">
              Cancel
            </button>
            <button type="submit" disabled={loading || !password}
              className="px-3 py-1.5 text-sm font-medium text-white bg-red-700 hover:bg-red-600 disabled:opacity-50 rounded-lg transition-all flex items-center gap-1.5">
              {loading ? <Loader size={12} className="animate-spin" /> : <ShieldOff size={12} />}
              Disable 2FA
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ChangePasswordModal({ onDone, onCancel }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!currentPassword || !newPassword || !confirmPassword) {
      setError('All fields are required');
      return;
    }
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await api.changeMyPassword(currentPassword, newPassword);
      onDone();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to change password');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#151a22] border border-slate-700 rounded-2xl p-5 w-full max-w-sm shadow-2xl mx-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Key size={16} className="text-blue-400" />
            <h3 className="font-semibold text-slate-100 text-sm">Change Password</h3>
          </div>
          <button onClick={onCancel} className="text-slate-500 hover:text-slate-300"><X size={16} /></button>
        </div>

        {error && (
          <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-lg p-2.5 mb-3 text-sm text-red-300">
            <AlertCircle size={13} /> {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <label className="block text-xs font-mono text-slate-400 mb-1.5 uppercase">Current Password</label>
          <input
            type="password"
            value={currentPassword}
            onChange={e => setCurrentPassword(e.target.value)}
            autoFocus
            className="w-full bg-[#0f1318] border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 font-mono focus:outline-none focus:border-blue-500/60 mb-3"
          />

          <label className="block text-xs font-mono text-slate-400 mb-1.5 uppercase">New Password</label>
          <input
            type="password"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            className="w-full bg-[#0f1318] border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 font-mono focus:outline-none focus:border-blue-500/60 mb-3"
          />

          <label className="block text-xs font-mono text-slate-400 mb-1.5 uppercase">Confirm New Password</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            className="w-full bg-[#0f1318] border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 font-mono focus:outline-none focus:border-blue-500/60"
          />

          <div className="mt-2 text-[11px] text-slate-500">
            After changing your password, all active sessions are signed out.
          </div>

          <div className="flex gap-2 justify-end mt-4">
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-all"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg transition-all flex items-center gap-1.5"
            >
              {loading ? <Loader size={12} className="animate-spin" /> : <Check size={12} />}
              Update Password
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Session Row ─────────────────────────────────────────────────────────────

function SessionRow({ session, currentSessionId, onRevoke, isAdmin, showUser }) {
  const [revoking, setRevoking] = useState(false);
  const isCurrent = session.id === currentSessionId;

  const handleRevoke = async () => {
    setRevoking(true);
    try { await onRevoke(session.id); } finally { setRevoking(false); }
  };

  const browser = session.user_agent
    ? session.user_agent.includes('Firefox') ? 'Firefox'
    : session.user_agent.includes('Chrome') ? 'Chrome'
    : session.user_agent.includes('Safari') ? 'Safari'
    : session.user_agent.includes('Edge') ? 'Edge'
    : 'Browser'
    : 'Unknown';

  return (
    <div className={`flex items-center gap-3 px-4 py-3 border-b border-slate-800/50 hover:bg-slate-800/10
      ${isCurrent ? 'bg-blue-500/5' : ''}`}>
      <Monitor size={13} className={isCurrent ? 'text-blue-400' : 'text-slate-500'} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {showUser && session.username && (
            <span className="text-xs font-mono text-blue-300">{session.username}</span>
          )}
          <span className="text-xs font-mono text-slate-300">{session.ip_address || 'Unknown IP'}</span>
          <span className="text-xs text-slate-600">·</span>
          <span className="text-xs text-slate-500">{browser}</span>
          {isCurrent && (
            <span className="text-[10px] font-mono text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded">current</span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-0.5">
          <span className="text-[10px] text-slate-600 flex items-center gap-1">
            <Clock size={9} />
            Active {formatDistanceToNow(new Date(session.last_active), { addSuffix: true })}
          </span>
          <span className="text-[10px] text-slate-700">
            Created {format(new Date(session.created_at), 'MMM d, HH:mm')}
          </span>
        </div>
      </div>
      {!isCurrent && (
        <button
          onClick={handleRevoke}
          disabled={revoking}
          className="p-1.5 rounded text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-all"
          title="Revoke session"
        >
          {revoking ? <Loader size={12} className="animate-spin" /> : <LogOut size={12} />}
        </button>
      )}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function SecurityPage() {
  const { user, isAdmin, logout } = useAuth();
  const toast = useToast();
  const [modal, setModal]             = useState(null); // '2fa-setup' | '2fa-disable' | 'password'
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [sessions, setSessions]       = useState([]);
  const [allSessions, setAllSessions] = useState([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const currentSessionId = localStorage.getItem('hv_session_id');

  const fetchMe = useCallback(async () => {
    try {
      const data = await api.getMe();
      setTotpEnabled(!!data.user?.totp_enabled);
    } catch {}
  }, []);

  const fetchSessions = useCallback(async () => {
    setLoadingSessions(true);
    try {
      const [mine, all] = await Promise.all([
        api.getSessions(),
        isAdmin ? api.getAllSessions() : Promise.resolve([]),
      ]);
      setSessions(mine);
      setAllSessions(all);
    } catch {}
    finally { setLoadingSessions(false); }
  }, [isAdmin]);

  useEffect(() => {
    fetchMe();
    fetchSessions();
  }, [fetchMe, fetchSessions]);

  const handleRevoke = async (sessionId) => {
    try {
      await api.revokeSession(sessionId);
      toast.success('Session revoked');
      fetchSessions();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to revoke session');
    }
  };

  const handleRevokeAll = async (userId, username) => {
    try {
      await api.revokeUserSessions(userId);
      toast.success(`All sessions for "${username}" revoked`);
      fetchSessions();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed');
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <ToastContainer toasts={toast.toasts} removeToast={toast.removeToast} />

      {modal === '2fa-setup' && (
        <TwoFASetup
          onDone={(msg) => { toast.success(msg); setModal(null); fetchMe(); }}
          onCancel={() => setModal(null)}
        />
      )}
      {modal === '2fa-disable' && (
        <Disable2FAModal
          onDone={(msg) => { toast.success(msg); setModal(null); fetchMe(); }}
          onCancel={() => setModal(null)}
        />
      )}
      {modal === 'password' && (
        <ChangePasswordModal
          onDone={async () => {
            toast.success('Password changed. Please sign in again.');
            setModal(null);
            await logout();
          }}
          onCancel={() => setModal(null)}
        />
      )}

      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-100">Security</h1>
        <p className="text-sm text-slate-500 mt-0.5">Manage two-factor authentication and active sessions</p>
      </div>

      {/* ── 2FA Section ── */}
      <div className="bg-[#0f1318] border border-slate-800 rounded-2xl p-5 mb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-start gap-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0
              ${totpEnabled ? 'bg-green-500/10 border border-green-500/20' : 'bg-slate-800 border border-slate-700'}`}>
              {totpEnabled
                ? <ShieldCheck size={17} className="text-green-400" />
                : <ShieldOff size={17} className="text-slate-500" />
              }
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-200">Two-Factor Authentication</span>
                <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${totpEnabled
                  ? 'bg-green-500/10 text-green-400'
                  : 'bg-slate-800 text-slate-500'}`}>
                  {totpEnabled ? 'ENABLED' : 'DISABLED'}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {totpEnabled
                  ? 'Your account requires a code from your authenticator app on login.'
                  : 'Add an extra layer of security with Google Authenticator or Authy.'}
              </p>
            </div>
          </div>
          <button
            onClick={() => setModal(totpEnabled ? '2fa-disable' : '2fa-setup')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5
              ${totpEnabled
                ? 'text-red-400 border border-red-500/20 hover:bg-red-500/10'
                : 'text-blue-400 border border-blue-500/20 hover:bg-blue-500/10'}`}
          >
            {totpEnabled
              ? <><ShieldOff size={12} /> Disable</>
              : <><Smartphone size={12} /> Enable 2FA</>}
          </button>
        </div>
      </div>

      <div className="bg-[#0f1318] border border-slate-800 rounded-2xl p-5 mb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-slate-800 border border-slate-700">
              <Key size={17} className="text-slate-400" />
            </div>
            <div>
              <div className="text-sm font-medium text-slate-200">Password</div>
              <p className="text-xs text-slate-500 mt-0.5">
                Change your account password using your current password.
              </p>
            </div>
          </div>
          <button
            onClick={() => setModal('password')}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all text-blue-400 border border-blue-500/20 hover:bg-blue-500/10 flex items-center gap-1.5"
          >
            <Key size={12} />
            Change Password
          </button>
        </div>
      </div>

      {/* ── My Sessions ── */}
      <div className="bg-[#0f1318] border border-slate-800 rounded-2xl overflow-hidden mb-4">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-mono text-slate-400 uppercase tracking-wider">
            <Key size={11} /> My Active Sessions
            {sessions.length > 0 && <span className="text-slate-600">({sessions.length})</span>}
          </div>
          <button onClick={fetchSessions} className="text-slate-600 hover:text-slate-400 transition-colors">
            <RefreshCw size={11} />
          </button>
        </div>
        {loadingSessions ? (
          <div className="flex items-center justify-center py-8"><Spinner /></div>
        ) : sessions.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-600 font-mono">No active sessions</div>
        ) : (
          sessions.map(s => (
            <SessionRow
              key={s.id}
              session={s}
              currentSessionId={currentSessionId}
              onRevoke={handleRevoke}
              isAdmin={isAdmin}
              showUser={false}
            />
          ))
        )}
      </div>

      {/* ── All Sessions (admin only) ── */}
      {isAdmin && (
        <div className="bg-[#0f1318] border border-slate-800 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-mono text-slate-400 uppercase tracking-wider">
              <Users size={11} /> All User Sessions
              {allSessions.length > 0 && <span className="text-slate-600">({allSessions.length})</span>}
            </div>
            <button onClick={fetchSessions} className="text-slate-600 hover:text-slate-400 transition-colors">
              <RefreshCw size={11} />
            </button>
          </div>
          {loadingSessions ? (
            <div className="flex items-center justify-center py-8"><Spinner /></div>
          ) : allSessions.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-600 font-mono">No active sessions</div>
          ) : (
            <>
              {/* Group by user */}
              {Object.entries(
                allSessions.reduce((acc, s) => {
                  const key = s.username;
                  if (!acc[key]) acc[key] = { userId: s.user_id, sessions: [] };
                  acc[key].sessions.push(s);
                  return acc;
                }, {})
              ).map(([username, { userId, sessions: userSessions }]) => (
                <div key={username}>
                  <div className="flex items-center justify-between px-4 py-2 bg-slate-800/20 border-b border-slate-800/50">
                    <span className="text-[11px] font-mono text-slate-400">{username}</span>
                    {userId !== user?.id && (
                      <button
                        onClick={() => handleRevokeAll(userId, username)}
                        className="flex items-center gap-1 text-[10px] font-mono text-slate-600 hover:text-red-400 transition-colors"
                      >
                        <Trash2 size={10} /> Revoke all
                      </button>
                    )}
                  </div>
                  {userSessions.map(s => (
                    <SessionRow
                      key={s.id}
                      session={s}
                      currentSessionId={currentSessionId}
                      onRevoke={handleRevoke}
                      isAdmin={isAdmin}
                      showUser={false}
                    />
                  ))}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
