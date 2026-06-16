import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Server, Lock, User, AlertCircle, Loader, ShieldCheck, KeyRound } from 'lucide-react';

export default function LoginPage() {
  const [username, setUsername]   = useState('');
  const [password, setPassword]   = useState('');
  const [totpCode, setTotpCode]   = useState('');
  const [step, setStep]           = useState('credentials'); // 'credentials' | '2fa'
  const [error, setError]         = useState('');
  const [locked, setLocked]       = useState(false);
  const { login, loading }        = useAuth();
  const navigate                  = useNavigate();

  const handleCredentials = async (e) => {
    e.preventDefault();
    setError('');
    setLocked(false);
    try {
      const data = await login(username, password);
      if (data?.requires_2fa) {
        setStep('2fa');
        return;
      }
      navigate('/');
    } catch (err) {
      const msg = err.response?.data?.error || 'Login failed. Check your credentials.';
      setError(msg);
      if (err.response?.data?.locked) setLocked(true);
    }
  };

  const handle2FA = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await login(username, password, totpCode);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || 'Invalid 2FA code.');
      setTotpCode('');
    }
  };

  return (
    <div className="min-h-screen grid-bg flex items-center justify-center px-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(59,130,246,0.06) 0%, transparent 70%)' }} />
      </div>

      <div className="relative w-full max-w-sm animate-fade-in">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-500/10 border border-blue-500/20 mb-4">
            {step === '2fa'
              ? <ShieldCheck size={24} className="text-blue-400" />
              : <Server size={24} className="text-blue-400" />
            }
          </div>
          <h1 className="text-2xl font-semibold text-slate-100 font-sans tracking-tight">Hyper-V Panel</h1>
          <p className="text-slate-500 text-sm mt-1 font-mono">
            {step === '2fa' ? 'Two-Factor Authentication' : 'Control Center v1.0'}
          </p>
        </div>

        <div className="bg-[#0f1318] border border-slate-800 rounded-2xl p-6 shadow-2xl">
          {error && (
            <div className={`flex items-start gap-2 border rounded-lg px-3 py-2.5 mb-4 animate-fade-in
              ${locked ? 'bg-orange-500/10 border-orange-500/20' : 'bg-red-500/10 border-red-500/20'}`}>
              <AlertCircle size={14} className={`shrink-0 mt-0.5 ${locked ? 'text-orange-400' : 'text-red-400'}`} />
              <span className={`text-sm ${locked ? 'text-orange-300' : 'text-red-300'}`}>{error}</span>
            </div>
          )}

          {/* Step 1: credentials */}
          {step === 'credentials' && (
            <form onSubmit={handleCredentials} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5 font-mono uppercase tracking-wider">
                  Username
                </label>
                <div className="relative">
                  <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    className="w-full bg-[#151a22] border border-slate-700 rounded-lg pl-9 pr-4 py-2.5 text-sm text-slate-200
                      placeholder:text-slate-600 focus:outline-none focus:border-blue-500/60 focus:bg-[#1c2330] transition-all font-mono"
                    placeholder="admin"
                    autoComplete="username"
                    required
                    disabled={locked}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5 font-mono uppercase tracking-wider">
                  Password
                </label>
                <div className="relative">
                  <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="w-full bg-[#151a22] border border-slate-700 rounded-lg pl-9 pr-4 py-2.5 text-sm text-slate-200
                      placeholder:text-slate-600 focus:outline-none focus:border-blue-500/60 focus:bg-[#1c2330] transition-all font-mono"
                    placeholder="••••••••"
                    autoComplete="current-password"
                    required
                    disabled={locked}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || locked}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 text-white
                  font-medium py-2.5 rounded-lg transition-all text-sm btn-glow flex items-center justify-center gap-2 mt-2"
              >
                {loading ? <><Loader size={14} className="animate-spin" /> Authenticating...</> : 'Sign In'}
              </button>
            </form>
          )}

          {/* Step 2: 2FA */}
          {step === '2fa' && (
            <form onSubmit={handle2FA} className="space-y-4">
              <div className="text-center mb-2">
                <p className="text-sm text-slate-400">Enter the 6-digit code from your authenticator app.</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5 font-mono uppercase tracking-wider">
                  Authenticator Code
                </label>
                <div className="relative">
                  <KeyRound size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    value={totpCode}
                    onChange={e => setTotpCode(e.target.value.replace(/\D/g, ''))}
                    className="w-full bg-[#151a22] border border-slate-700 rounded-lg pl-9 pr-4 py-2.5 text-sm text-slate-200
                      placeholder:text-slate-600 focus:outline-none focus:border-blue-500/60 focus:bg-[#1c2330] transition-all font-mono
                      tracking-[0.4em] text-center text-lg"
                    placeholder="000000"
                    autoFocus
                    autoComplete="one-time-code"
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || totpCode.length !== 6}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 text-white
                  font-medium py-2.5 rounded-lg transition-all text-sm btn-glow flex items-center justify-center gap-2"
              >
                {loading ? <><Loader size={14} className="animate-spin" /> Verifying...</> : 'Verify'}
              </button>

              <button
                type="button"
                onClick={() => { setStep('credentials'); setError(''); setTotpCode(''); }}
                className="w-full text-slate-500 hover:text-slate-300 text-xs font-mono transition-colors"
              >
                ← Back to login
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-xs text-slate-600 mt-4 font-mono">
          Hyper-V Management Interface · Secure Access Required
        </p>
      </div>
    </div>
  );
}
