import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import VMsPage from './pages/VMsPage';
import VMDetailPage from './pages/VMDetailPage';
import LogsPage from './pages/LogsPage';
import UsersPage from './pages/UsersPage';
import SettingsPage from './pages/SettingsPage';
import SecurityPage from './pages/SecurityPage';
import AlertsPage from './pages/AlertsPage';
import ClientsPage from './pages/ClientsPage';
import { DDoSProtectionPage } from './pages/DDoSProtectionPage';
import ConsolePage from './pages/ConsolePage';
import './index.css';

function ProtectedRoute({ children, adminOnly, noLayout }) {
  const auth = useAuth();
  const user = auth?.user;
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && user.role !== 'admin') return <Navigate to="/" replace />;
  if (noLayout) return children;
  return <Layout>{children}</Layout>;
}

function AppRoutes() {
  const auth = useAuth();
  const user = auth?.user;
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" /> : <LoginPage />} />
      <Route path="/" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
      <Route path="/vms" element={<ProtectedRoute><VMsPage /></ProtectedRoute>} />
      <Route path="/vms/:name"         element={<ProtectedRoute><VMDetailPage /></ProtectedRoute>} />
      <Route path="/vms/:name/console" element={<ProtectedRoute noLayout><ConsolePage /></ProtectedRoute>} />
      <Route path="/vms/:name/hv-console" element={<ProtectedRoute noLayout><ConsolePage /></ProtectedRoute>} />
      <Route path="/logs" element={<ProtectedRoute><LogsPage /></ProtectedRoute>} />
      <Route path="/users" element={<ProtectedRoute adminOnly><UsersPage /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute adminOnly><SettingsPage /></ProtectedRoute>} />
      <Route path="/security" element={<ProtectedRoute><SecurityPage /></ProtectedRoute>} />
      <Route path="/alerts"   element={<ProtectedRoute adminOnly><AlertsPage /></ProtectedRoute>} />
      <Route path="/ddos"     element={<ProtectedRoute adminOnly><DDoSProtectionPage /></ProtectedRoute>} />
      <Route path="/clients"  element={<ProtectedRoute><ClientsPage /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
