import { createContext, useContext, useState, useEffect } from 'react';
import { login as apiLogin, logout as apiLogout } from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('hv_user')); } catch { return null; }
  });
  const [loading, setLoading] = useState(false);

  // Returns { requires_2fa: true } if 2FA step needed, otherwise logs in fully
  const login = async (username, password, totp_code = null) => {
    setLoading(true);
    try {
      const data = await apiLogin(username, password, totp_code);

      if (data.requires_2fa) {
        // Don't store anything yet — caller handles the 2FA prompt
        return data;
      }

      localStorage.setItem('hv_token', data.token);
      localStorage.setItem('hv_refresh_token', data.refresh_token);
      localStorage.setItem('hv_session_id', data.session_id);
      localStorage.setItem('hv_user', JSON.stringify(data.user));
      setUser(data.user);
      return data;
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    const sessionId = localStorage.getItem('hv_session_id');
    try { await apiLogout(sessionId); } catch {}
    localStorage.removeItem('hv_token');
    localStorage.removeItem('hv_refresh_token');
    localStorage.removeItem('hv_session_id');
    localStorage.removeItem('hv_user');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, loading, isAdmin: user?.role === 'admin' }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
