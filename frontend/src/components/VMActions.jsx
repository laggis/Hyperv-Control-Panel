import { useState, useEffect, useRef } from 'react';
import { Play, Square, RotateCcw, PauseCircle, PlayCircle, Camera, X, AlertTriangle, Loader, KeyRound, Eye, EyeOff, ShieldAlert } from 'lucide-react';
import * as api from '../api';

function ConfirmModal({ title, message, confirmLabel = 'Confirm', danger = false, onConfirm, onCancel, loading }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-[#151a22] border border-slate-700 rounded-2xl p-5 w-full max-w-sm shadow-2xl animate-slide-up mx-4">
        <div className="flex items-start gap-3 mb-4">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${danger ? 'bg-red-500/10' : 'bg-yellow-500/10'}`}>
            <AlertTriangle size={16} className={danger ? 'text-red-400' : 'text-yellow-400'} />
          </div>
          <div>
            <h3 className="font-semibold text-slate-100 text-sm">{title}</h3>
            <p className="text-slate-400 text-sm mt-1">{message}</p>
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="px-3 py-1.5 rounded-lg text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-all">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium text-white transition-all flex items-center gap-1.5
              ${danger ? 'bg-red-600 hover:bg-red-500' : 'bg-yellow-600 hover:bg-yellow-500'}
              disabled:opacity-60`}
          >
            {loading ? <Loader size={12} className="animate-spin" /> : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function SnapshotModal({ vmName, onDone, onCancel }) {
  const [name, setName] = useState(`Snapshot-${new Date().toISOString().slice(0, 16).replace('T', '_')}`);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async () => {
    if (!name.trim()) return;
    setLoading(true);
    setError('');
    try {
      await api.createSnapshot(vmName, name.trim());
      onDone(`Snapshot "${name}" created`);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-[#151a22] border border-slate-700 rounded-2xl p-5 w-full max-w-sm shadow-2xl animate-slide-up mx-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Camera size={16} className="text-blue-400" />
            <h3 className="font-semibold text-slate-100 text-sm">Create Snapshot</h3>
          </div>
          <button onClick={onCancel} className="text-slate-500 hover:text-slate-300">
            <X size={16} />
          </button>
        </div>
        <p className="text-xs text-slate-500 mb-3 font-mono">VM: {vmName}</p>

        {error && (
          <div className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg p-2 mb-3">{error}</div>
        )}

        <label className="block text-xs text-slate-400 mb-1.5 font-mono">Snapshot Name</label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          className="w-full bg-[#0f1318] border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200
            font-mono focus:outline-none focus:border-blue-500/60 mb-4"
          autoFocus
          onKeyDown={e => e.key === 'Enter' && handleCreate()}
        />

        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="px-3 py-1.5 rounded-lg text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-all">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={loading || !name.trim()}
            className="px-3 py-1.5 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-60 transition-all flex items-center gap-1.5"
          >
            {loading ? <Loader size={12} className="animate-spin" /> : <Camera size={12} />}
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

function PasswordInput({ label, value, onChange, placeholder, autoFocus }) {
  const [show, setShow] = useState(false);
  return (
    <div className="mb-3">
      <label className="block text-xs text-slate-400 mb-1.5 font-mono">{label}</label>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className="w-full bg-[#0f1318] border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200
            font-mono focus:outline-none focus:border-blue-500/60 pr-9"
        />
        <button
          type="button"
          onClick={() => setShow(s => !s)}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
        >
          {show ? <EyeOff size={13} /> : <Eye size={13} />}
        </button>
      </div>
    </div>
  );
}

function ResetPasswordModal({ vmName, onDone, onCancel }) {
  const [form, setForm] = useState({
    guestUser: 'Administrator',
    guestPassword: '',
    targetUser: 'Administrator',
    newPassword: '',
    confirmPassword: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const set = (field) => (val) => setForm(f => ({ ...f, [field]: val }));

  const handleSubmit = async () => {
    setError('');
    if (!form.guestPassword) return setError('Guest password is required');
    if (!form.newPassword) return setError('New password is required');
    if (form.newPassword.length < 6) return setError('New password must be at least 6 characters');
    if (form.newPassword !== form.confirmPassword) return setError('Passwords do not match');

    setLoading(true);
    try {
      await api.resetVMPassword(vmName, form.guestUser, form.guestPassword, form.targetUser, form.newPassword);
      onDone(`Password for "${form.targetUser}" reset successfully`);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-[#151a22] border border-slate-700 rounded-2xl p-5 w-full max-w-sm shadow-2xl animate-slide-up mx-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <KeyRound size={16} className="text-orange-400" />
            <h3 className="font-semibold text-slate-100 text-sm">Reset VM Password</h3>
          </div>
          <button onClick={onCancel} className="text-slate-500 hover:text-slate-300">
            <X size={16} />
          </button>
        </div>
        <p className="text-xs text-slate-500 mb-4 font-mono">VM: {vmName}</p>

        {/* Info banner */}
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg px-3 py-2 mb-4 text-xs text-blue-300 font-mono leading-relaxed">
          Uses PowerShell Direct (Hyper-V Integration Services). The VM must be running with Integration Services installed.
        </div>

        {error && (
          <div className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg p-2 mb-3">{error}</div>
        )}

        {/* Section: Authenticate into the guest */}
        <div className="text-[10px] text-slate-500 uppercase tracking-wider font-mono mb-2">Guest Credentials (to connect)</div>
        <div className="mb-3">
          <label className="block text-xs text-slate-400 mb-1.5 font-mono">Guest Admin Username</label>
          <input
            value={form.guestUser}
            onChange={e => set('guestUser')(e.target.value)}
            className="w-full bg-[#0f1318] border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200
              font-mono focus:outline-none focus:border-blue-500/60"
          />
        </div>
        <PasswordInput
          label="Guest Admin Password"
          value={form.guestPassword}
          onChange={set('guestPassword')}
          placeholder="Current password to connect"
          autoFocus
        />

        {/* Section: Account to change */}
        <div className="text-[10px] text-slate-500 uppercase tracking-wider font-mono mb-2 mt-1">Account to Reset</div>
        <div className="mb-3">
          <label className="block text-xs text-slate-400 mb-1.5 font-mono">Target Username</label>
          <input
            value={form.targetUser}
            onChange={e => set('targetUser')(e.target.value)}
            className="w-full bg-[#0f1318] border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200
              font-mono focus:outline-none focus:border-blue-500/60"
          />
        </div>
        <PasswordInput
          label="New Password"
          value={form.newPassword}
          onChange={set('newPassword')}
          placeholder="Min 6 characters"
        />
        <PasswordInput
          label="Confirm New Password"
          value={form.confirmPassword}
          onChange={set('confirmPassword')}
          placeholder="Repeat new password"
        />

        <div className="flex gap-2 justify-end mt-2">
          <button onClick={onCancel} className="px-3 py-1.5 rounded-lg text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-all">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="px-3 py-1.5 rounded-lg text-sm font-medium text-white bg-orange-600 hover:bg-orange-500 disabled:opacity-60 transition-all flex items-center gap-1.5"
          >
            {loading ? <Loader size={12} className="animate-spin" /> : <KeyRound size={12} />}
            Reset Password
          </button>
        </div>
      </div>
    </div>
  );
}

function EmergencyResetModal({ vmName, vmState, onDone, onCancel }) {
  const isRunning = String(vmState || '').toLowerCase().includes('running');
  const [form, setForm] = useState({
    targetUser: 'Administrator',
    newPassword: '',
    confirmPassword: '',
    restartAfter: true,
  });
  const [step, setStep] = useState('form'); // 'form' | 'confirm' | 'working' | 'done'
  const [error, setError] = useState('');
  const [resultMsg, setResultMsg] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef(null);

  useEffect(() => {
    if (step === 'working') {
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [step]);

  const set = (field) => (val) => setForm(f => ({ ...f, [field]: val }));

  const validate = () => {
    if (!form.targetUser.trim()) return 'Target username is required';
    if (!form.newPassword) return 'New password is required';
    if (form.newPassword.length < 6) return 'Password must be at least 6 characters';
    if (form.newPassword !== form.confirmPassword) return 'Passwords do not match';
    return null;
  };

  const handleConfirm = () => {
    const err = validate();
    if (err) { setError(err); return; }
    setError('');
    setStep('confirm');
  };

  const handleExecute = async () => {
    setStep('working');
    setError('');
    try {
      const res = await api.emergencyResetVMPassword(vmName, form.targetUser, form.newPassword, form.restartAfter);
      setResultMsg(res.detail || 'Password reset task injected successfully.');
      setStep('done');
    } catch (err) {
      const detail = err.response?.data?.error || err.message || 'Unknown error';
      setError(detail);
      setStep('error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in">
      <div className="bg-[#151a22] border border-red-900/50 rounded-2xl p-5 w-full max-w-sm shadow-2xl animate-slide-up mx-4">

        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-red-500/15 flex items-center justify-center">
              <ShieldAlert size={15} className="text-red-400" />
            </div>
            <h3 className="font-semibold text-slate-100 text-sm">Emergency Password Reset</h3>
          </div>
          {step !== 'working' && (
            <button onClick={onCancel} className="text-slate-500 hover:text-slate-300"><X size={16} /></button>
          )}
        </div>
        <p className="text-xs text-slate-500 font-mono mb-4">VM: {vmName}</p>

        {/* Step: form */}
        {step === 'form' && (
          <>
            {/* Warning banner */}
            <div className="bg-red-500/10 border border-red-500/25 rounded-lg px-3 py-2.5 mb-4 text-xs text-red-300 leading-relaxed">
              <div className="font-semibold mb-1 flex items-center gap-1.5"><AlertTriangle size={11} /> Offline VHD method</div>
              No guest credentials needed. The VM will be <strong>stopped</strong>, its disk mounted on the host, a password-reset task injected, then the VM restarted. Works even if the VM has been compromised.
            </div>

            {error && (
              <div className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg p-2 mb-3">{error}</div>
            )}

            <div className="mb-3">
              <label className="block text-xs text-slate-400 mb-1.5 font-mono">Target Username</label>
              <input
                value={form.targetUser}
                onChange={e => set('targetUser')(e.target.value)}
                className="w-full bg-[#0f1318] border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200
                  font-mono focus:outline-none focus:border-red-500/60"
                autoFocus
              />
            </div>
            <PasswordInput label="New Password" value={form.newPassword} onChange={set('newPassword')} placeholder="Min 6 characters" />
            <PasswordInput label="Confirm New Password" value={form.confirmPassword} onChange={set('confirmPassword')} placeholder="Repeat new password" />

            <label className="flex items-center gap-2 text-xs text-slate-400 font-mono cursor-pointer mb-4 mt-1 select-none">
              <input
                type="checkbox"
                checked={form.restartAfter}
                onChange={e => set('restartAfter')(e.target.checked)}
                className="accent-red-500"
              />
              Restart VM automatically after reset
            </label>

            <div className="flex gap-2 justify-end">
              <button onClick={onCancel} className="px-3 py-1.5 rounded-lg text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-all">
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                className="px-3 py-1.5 rounded-lg text-sm font-medium text-white bg-red-700 hover:bg-red-600 transition-all flex items-center gap-1.5"
              >
                <ShieldAlert size={12} />
                Continue
              </button>
            </div>
          </>
        )}

        {/* Step: confirm */}
        {step === 'confirm' && (
          <>
            <div className="bg-yellow-500/10 border border-yellow-500/25 rounded-lg px-3 py-3 mb-4 text-xs text-yellow-300 leading-relaxed space-y-1">
              <div className="font-semibold flex items-center gap-1.5"><AlertTriangle size={11} /> Are you sure?</div>
              {isRunning && <div>• The VM <strong>{vmName}</strong> will be <strong>force-stopped</strong> immediately.</div>}
              <div>• Its VHD will be mounted on the Hyper-V host.</div>
              <div>• Account <strong>{form.targetUser}</strong> password will be reset on next boot.</div>
              {form.restartAfter && <div>• The VM will be restarted automatically.</div>}
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setStep('form')} className="px-3 py-1.5 rounded-lg text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-all">
                Back
              </button>
              <button
                onClick={handleExecute}
                className="px-3 py-1.5 rounded-lg text-sm font-medium text-white bg-red-700 hover:bg-red-600 transition-all flex items-center gap-1.5"
              >
                <ShieldAlert size={12} />
                Execute Reset
              </button>
            </div>
          </>
        )}

        {/* Step: working */}
        {step === 'working' && (
          <div className="flex flex-col items-center py-6 gap-4">
            <Loader size={24} className="animate-spin text-red-400" />
            <div className="text-sm text-slate-400 font-mono text-center leading-relaxed">
              Working…<br />
              <span className="text-xs text-slate-500">Stopping VM · Mounting VHD · Injecting task</span>
            </div>
            <div className="bg-[#0f1318] border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-600 w-full text-center leading-relaxed">
              This can take <strong className="text-slate-500">2–4 minutes</strong>. Do not close this window.<br />
              <span className="text-slate-500">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')} elapsed</span>
            </div>
          </div>
        )}

        {/* Step: error */}
        {step === 'error' && (
          <>
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 mb-4">
              <div className="text-xs font-mono text-red-400 font-medium mb-1 flex items-center gap-1.5">
                <AlertTriangle size={11} /> Reset failed
              </div>
              <div className="text-xs font-mono text-slate-400 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
                {error}
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={onCancel} className="px-3 py-1.5 rounded-lg text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-all">
                Close
              </button>
              <button onClick={() => { setStep('form'); setError(''); }} className="px-3 py-1.5 rounded-lg text-sm font-medium text-white bg-slate-700 hover:bg-slate-600 transition-all">
                Try Again
              </button>
            </div>
          </>
        )}

        {/* Step: done */}
        {step === 'done' && (
          <>
            <div className="bg-green-500/10 border border-green-500/25 rounded-lg px-3 py-3 mb-4 text-xs text-green-300 leading-relaxed">
              <div className="font-semibold mb-1">✓ Reset task injected</div>
              <div className="text-slate-400">{resultMsg}</div>
              {form.restartAfter
                ? <div className="mt-1">The VM is restarting. The password for <strong>{form.targetUser}</strong> will be reset within the first few seconds of boot.</div>
                : <div className="mt-1">Start the VM manually — the password for <strong>{form.targetUser}</strong> will be reset on first boot, then the reset script deletes itself.</div>
              }
            </div>
            <div className="flex justify-end">
              <button
                onClick={() => onDone(`Emergency reset queued for "${form.targetUser}" on ${vmName}`)}
                className="px-3 py-1.5 rounded-lg text-sm font-medium text-white bg-slate-700 hover:bg-slate-600 transition-all"
              >
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// active = action makes sense for the current VM state (solid colored button)
// inactive = greyed out but still visible (so layout stays consistent)
function ActionButton({ icon: Icon, label, variant, active, loading, disabled, onClick }) {
  const styles = {
    green:  {
      solid: 'bg-green-600 hover:bg-green-500 text-white border-green-700',
      ghost: 'bg-slate-800/40 text-slate-600 border-slate-700/40 cursor-not-allowed',
    },
    red:    {
      solid: 'bg-red-700 hover:bg-red-600 text-white border-red-800',
      ghost: 'bg-slate-800/40 text-slate-600 border-slate-700/40 cursor-not-allowed',
    },
    yellow: {
      solid: 'bg-yellow-600 hover:bg-yellow-500 text-white border-yellow-700',
      ghost: 'bg-slate-800/40 text-slate-600 border-slate-700/40 cursor-not-allowed',
    },
    blue:   {
      solid: 'bg-blue-600 hover:bg-blue-500 text-white border-blue-700',
      ghost: 'bg-slate-800/40 text-slate-600 border-slate-700/40 cursor-not-allowed',
    },
    slate:  {
      solid: 'bg-slate-700 hover:bg-slate-600 text-slate-200 border-slate-600',
      ghost: 'bg-slate-800/40 text-slate-600 border-slate-700/40 cursor-not-allowed',
    },
  };

  const isActive = active && !disabled;
  const cls = isActive ? styles[variant].solid : styles[variant].ghost;

  return (
    <button
      onClick={isActive ? onClick : undefined}
      disabled={disabled}
      title={label}
      className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-mono font-medium border transition-all select-none ${cls}`}
    >
      {loading ? <Loader size={12} className="animate-spin" /> : <Icon size={12} />}
      {label}
    </button>
  );
}

export function VMActionBar({ vm, onAction, userRole, onEmergencyReset }) {
  const [modal, setModal] = useState(null);
  const [busyBtn, setBusyBtn] = useState(null);

  const canOperate = ['admin', 'operator', 'user'].includes(userRole);

  const perform = async (actionFn, label, btnKey) => {
    setBusyBtn(btnKey);
    try {
      await actionFn();
      onAction?.('success', `${label} successful`);
    } catch (err) {
      onAction?.('error', err.response?.data?.error || err.message);
    } finally {
      setBusyBtn(null);
      setModal(null);
    }
  };

  const NUMERIC_STATES = { 2: 'Running', 3: 'Off', 6: 'Saved', 9: 'Paused', 10: 'Starting', 32768: 'Stopping' };
  const rawState = vm?.State;
  const state = (NUMERIC_STATES[rawState] || rawState || '').toString().trim().toLowerCase();
  const memGB = Number(vm?.MemoryAssignedGB || 0);
  const isPaused = state.includes('paused');
  const isTransient = state.includes('starting') || state.includes('stopping') || state.includes('pausing') || state.includes('resuming');
  const isRunning = state.includes('running') || (!isPaused && !isTransient && memGB > 0);
  const isOff = !isRunning && !isPaused && !isTransient;
  const isBusy = busyBtn !== null;

  if (!canOperate) return null;

  return (
    <>
      {modal === 'stop-confirm' && (
        <ConfirmModal
          title="Stop Virtual Machine"
          message={`Stop "${vm.Name}"? Unsaved data inside the VM may be lost.`}
          confirmLabel="Stop VM"
          danger
          loading={busyBtn === 'stop'}
          onCancel={() => setModal(null)}
          onConfirm={() => perform(() => api.stopVM(vm.Name, false), 'Stop', 'stop')}
        />
      )}
      {modal === 'restart-confirm' && (
        <ConfirmModal
          title="Restart Virtual Machine"
          message={`Restart "${vm.Name}"? The VM will be rebooted.`}
          confirmLabel="Restart"
          loading={busyBtn === 'restart'}
          onCancel={() => setModal(null)}
          onConfirm={() => perform(() => api.restartVM(vm.Name), 'Restart', 'restart')}
        />
      )}
      {modal === 'snapshot' && (
        <SnapshotModal
          vmName={vm.Name}
          onDone={(msg) => { setModal(null); onAction?.('success', msg); }}
          onCancel={() => setModal(null)}
        />
      )}
      {modal === 'reset-password' && (
        <ResetPasswordModal
          vmName={vm.Name}
          onDone={(msg) => { setModal(null); onAction?.('success', msg); }}
          onCancel={() => setModal(null)}
        />
      )}

      <div className="flex items-center gap-1 flex-wrap">
        {/* START - lit up green when VM is Off */}
        <ActionButton
          icon={Play}
          label="Start"
          variant="green"
          active={isOff}
          loading={busyBtn === 'start'}
          disabled={isBusy || !isOff}
          onClick={() => perform(() => api.startVM(vm.Name), 'Start', 'start')}
        />

        {/* STOP - lit up red when Running or Paused */}
        <ActionButton
          icon={Square}
          label="Stop"
          variant="red"
          active={isRunning || isPaused}
          loading={busyBtn === 'stop'}
          disabled={isBusy || (!isRunning && !isPaused)}
          onClick={() => setModal('stop-confirm')}
        />

        {/* RESTART - lit up yellow when Running */}
        <ActionButton
          icon={RotateCcw}
          label="Restart"
          variant="yellow"
          active={isRunning}
          loading={busyBtn === 'restart'}
          disabled={isBusy || !isRunning}
          onClick={() => setModal('restart-confirm')}
        />

        {/* SUSPEND / RESUME */}
        {isPaused ? (
          <ActionButton
            icon={PlayCircle}
            label="Resume"
            variant="blue"
            active={true}
            loading={busyBtn === 'resume'}
            disabled={isBusy}
            onClick={() => perform(() => api.resumeVM(vm.Name), 'Resume', 'resume')}
          />
        ) : (
          <ActionButton
            icon={PauseCircle}
            label="Suspend"
            variant="blue"
            active={isRunning}
            loading={busyBtn === 'suspend'}
            disabled={isBusy || !isRunning}
            onClick={() => perform(() => api.suspendVM(vm.Name), 'Suspend', 'suspend')}
          />
        )}

        {/* SNAPSHOT - always available */}
        <ActionButton
          icon={Camera}
          label="Snapshot"
          variant="slate"
          active={true}
          loading={false}
          disabled={isBusy}
          onClick={() => setModal('snapshot')}
        />

        {/* RESET PASSWORD - only meaningful when VM is running */}
        <ActionButton
          icon={KeyRound}
          label="Reset Password"
          variant="slate"
          active={isRunning}
          loading={busyBtn === 'reset-password'}
          disabled={isBusy || !isRunning}
          onClick={() => setModal('reset-password')}
        />

        {/* EMERGENCY RESET - admin only, works on any state */}
        {userRole === 'admin' && (
          <ActionButton
            icon={ShieldAlert}
            label="Emergency Reset"
            variant="red"
            active={true}
            loading={busyBtn === 'emergency-reset'}
            disabled={isBusy}
            onClick={() => onEmergencyReset?.()}
          />
        )}
      </div>
    </>
  );
}

export { EmergencyResetModal };
