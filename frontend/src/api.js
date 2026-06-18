import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
});

// Attach JWT access token to every request
api.interceptors.request.use(config => {
  const token = localStorage.getItem('hv_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Auto-refresh on 401 using refresh token
let isRefreshing = false;
let refreshQueue = [];

api.interceptors.response.use(
  res => res,
  async err => {
    const original = err.config;
    if (err.response?.status === 401 && !original._retry) {
      const refreshToken = localStorage.getItem('hv_refresh_token');
      if (!refreshToken) {
        localStorage.removeItem('hv_token');
        localStorage.removeItem('hv_user');
        window.location.href = '/login';
        return Promise.reject(err);
      }

      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          refreshQueue.push({ resolve, reject });
        }).then(token => {
          original.headers.Authorization = `Bearer ${token}`;
          return api(original);
        });
      }

      original._retry = true;
      isRefreshing = true;

      try {
        const res = await axios.post('/api/auth/refresh', { refresh_token: refreshToken });
        const { token, refresh_token: newRefresh } = res.data;
        localStorage.setItem('hv_token', token);
        localStorage.setItem('hv_refresh_token', newRefresh);
        api.defaults.headers.common.Authorization = `Bearer ${token}`;
        refreshQueue.forEach(p => p.resolve(token));
        refreshQueue = [];
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      } catch {
        refreshQueue.forEach(p => p.reject(err));
        refreshQueue = [];
        localStorage.removeItem('hv_token');
        localStorage.removeItem('hv_refresh_token');
        localStorage.removeItem('hv_user');
        localStorage.removeItem('hv_session_id');
        window.location.href = '/login';
        return Promise.reject(err);
      } finally {
        isRefreshing = false;
      }
    }
    return Promise.reject(err);
  }
);

export default api;

// Auth
export const login = (username, password, totp_code) =>
  api.post('/auth/login', { username, password, totp_code }).then(r => r.data);
export const refreshToken = (refresh_token) =>
  api.post('/auth/refresh', { refresh_token }).then(r => r.data);
export const logout = (session_id) =>
  api.post('/auth/logout', { session_id }).then(r => r.data);
export const getMe = () => api.get('/auth/me').then(r => r.data);

// Sessions
export const getSessions = () => api.get('/auth/sessions').then(r => r.data);
export const getAllSessions = () => api.get('/auth/sessions/all').then(r => r.data);
export const revokeSession = (id) => api.delete(`/auth/sessions/${id}`).then(r => r.data);
export const revokeUserSessions = (userId) => api.delete(`/auth/sessions/user/${userId}`).then(r => r.data);
export const linkMyDiscord = (discord_id) => api.put('/auth/me/discord', { discord_id }).then(r => r.data);
export const changeMyPassword = (current_password, new_password) =>
  api.put('/auth/me/password', { current_password, new_password }).then(r => r.data);

// 2FA
export const setup2FA = () => api.post('/auth/2fa/setup').then(r => r.data);
export const verify2FA = (code) => api.post('/auth/2fa/verify', { code }).then(r => r.data);
export const disable2FA = (password) => api.delete('/auth/2fa', { data: { password } }).then(r => r.data);

// Users
export const getUsers = () => api.get('/auth/users').then(r => r.data);
export const createUser = (data) => api.post('/auth/users', data).then(r => r.data);
export const deleteUser = (id) => api.delete(`/auth/users/${id}`).then(r => r.data);
export const changePassword = (id, password) => api.put(`/auth/users/${id}/password`, { password }).then(r => r.data);
export const updateUserRole = (id, role) => api.put(`/auth/users/${id}/role`, { role }).then(r => r.data);
export const listUserVMs = (id) => api.get(`/auth/users/${id}/vms`).then(r => r.data);
// Assign VM access through the email-manager route so a secure assignment email
// can be sent to the user's saved email address. Passwords are never emailed.
export const assignUserVM = (id, vm_name, options = {}) =>
  api.post(`/vms/email-manager/users/${id}/vms`, { vm_name, ...options }).then(r => r.data);
export const unassignUserVM = (id, vm_name) => api.delete(`/auth/users/${id}/vms/${encodeURIComponent(vm_name)}`).then(r => r.data);
export const setUserDiscord = (id, discord_id) => api.put(`/auth/users/${id}/discord`, { discord_id }).then(r => r.data);
export const getDiscordWhitelist = () => api.get('/auth/discord/whitelist').then(r => r.data);
export const addDiscordWhitelist = (discord_id, note = '') => api.post('/auth/discord/whitelist', { discord_id, note }).then(r => r.data);
export const removeDiscordWhitelist = (discord_id) => api.delete(`/auth/discord/whitelist/${encodeURIComponent(discord_id)}`).then(r => r.data);

// VMs
export const listVMs = () => api.get('/vms').then(r => r.data);
export const listVMsWithMeta = () => api.get('/vms', {
  params: { _t: Date.now() }, // Cache-buster
}).then(r => ({
  vms: Array.isArray(r.data) ? r.data : [],
}));
export const getHealth = () => api.get('/health').then(r => r.data);
export const getVM = (name) => api.get(`/vms/${encodeURIComponent(name)}`).then(r => r.data);
export const getVMRdpInfo    = (name) => api.get(`/vms/${encodeURIComponent(name)}/rdp-info`).then(r => r.data);
export const getVMConsoleSession = (name) => api.get(`/vms/${encodeURIComponent(name)}/console-session`).then(r => r.data);
export const getVMConsoleUrl = (name) => api.get(`/vms/${encodeURIComponent(name)}/console-url`).then(r => r.data);
export const getVMConsoleConfig = (name) => api.get(`/vms/${encodeURIComponent(name)}/console-config`).then(r => r.data);
export const setVMConsoleConfig = (name, config) =>
  api.put(`/vms/${encodeURIComponent(name)}/console-config`, config).then(r => r.data);
export const startVM = (name) => api.post(`/vms/${encodeURIComponent(name)}/start`).then(r => r.data);
export const stopVM = (name, force = false) => api.post(`/vms/${encodeURIComponent(name)}/stop`, { force }).then(r => r.data);
export const restartVM = (name, force = false) => api.post(`/vms/${encodeURIComponent(name)}/restart`, { force }).then(r => r.data);
export const suspendVM = (name) => api.post(`/vms/${encodeURIComponent(name)}/suspend`).then(r => r.data);
export const resumeVM = (name) => api.post(`/vms/${encodeURIComponent(name)}/resume`).then(r => r.data);

// Snapshots
export const listSnapshots = (name) => api.get(`/vms/${encodeURIComponent(name)}/snapshots`).then(r => r.data);
export const createSnapshot = (name, snapshotName) => api.post(`/vms/${encodeURIComponent(name)}/snapshots`, { snapshotName }).then(r => r.data);
export const restoreSnapshot = (name, snapshotName, force = true) => api.post(`/vms/${encodeURIComponent(name)}/snapshots/${encodeURIComponent(snapshotName)}/restore`, { force }).then(r => r.data);
export const deleteSnapshot = (name, snapshotName) => api.delete(`/vms/${encodeURIComponent(name)}/snapshots/${encodeURIComponent(snapshotName)}`).then(r => r.data);

// Password reset
export const resetVMPassword = (name, guestUser, guestPassword, targetUser, newPassword) =>
  api.post(`/vms/${encodeURIComponent(name)}/reset-password`, { guestUser, guestPassword, targetUser, newPassword }).then(r => r.data);
export const emergencyResetVMPassword = (name, targetUser, newPassword, restartAfter = true) =>
  api.post(`/vms/${encodeURIComponent(name)}/emergency-reset-password`, { targetUser, newPassword, restartAfter }, { timeout: 300000 }).then(r => r.data);

// Logs
export const getLogs = (params = {}) => api.get('/logs', { params }).then(r => r.data);

export const getVmRoots = () => api.get('/vms/roots').then(r => r.data);
export const addVmRoot = (path) => api.post('/vms/roots', { path }).then(r => r.data);
export const deleteVmRoot = (id) => api.delete(`/vms/roots/${id}`).then(r => r.data);
export const discoverVMs = () => api.get('/vms/discover').then(r => r.data);
export const listVMNames = () => api.get('/vms/names').then(r => r.data);

// Settings
export const getSettings = () => api.get('/settings').then(r => r.data);
export const setShowAllVMs = (value) => api.put('/settings/show_all_vms', { value }).then(r => r.data);
export const setIsoFolder = (value) => api.put('/settings/iso_folder', { value }).then(r => r.data);
export const saveSMTP = (data) => api.put('/settings/smtp', data).then(r => r.data);
export const setDiscordWhitelistEnabled = (enabled) => api.put('/settings/discord-whitelist', { enabled }).then(r => r.data);

// Email notification manager
export const getEmailManager = () => api.get('/vms/email-manager').then(r => r.data);
export const updateEmailManagerUser = (userId, data) => api.put(`/vms/email-manager/users/${userId}`, data).then(r => r.data);
export const getMyEmailNotifications = () => api.get('/vms/email-manager/me').then(r => r.data);
export const saveMyEmailNotifications = (data) => api.put('/vms/email-manager/me', data).then(r => r.data);
export const testStopEmail = (vmName) => api.post(`/vms/${encodeURIComponent(vmName)}/test-stop-email`).then(r => r.data);
export const testSMTP = (to) => api.post('/vms/email-manager/test-smtp', { to }).then(r => r.data);

// VM Management (create/delete)
export const listSwitches = () => api.get('/vms-mgmt/switches').then(r => r.data);
export const createVM = (data) => api.post('/vms-mgmt/create', data).then(r => r.data);
export const deleteVM = (name, deleteFiles = false) => api.delete(`/vms-mgmt/${encodeURIComponent(name)}`, { data: { deleteFiles } }).then(r => r.data);
export const installVNC = (name, data) => api.post(`/vms-mgmt/${encodeURIComponent(name)}/install-vnc`, data).then(r => r.data);

// ISO Library
export const listISOs = () => api.get('/isos').then(r => r.data);
export const attachISO = (vmName, isoPath) => api.post('/isos/attach', { vmName, isoPath }).then(r => r.data);
export const detachISO = (vmName) => api.post('/isos/detach', { vmName }).then(r => r.data);
export const getVMDvd = (name) => api.get(`/isos/vm/${encodeURIComponent(name)}`).then(r => r.data);
export const setIsoFolderPath = (folder) => api.put('/isos/folder', { folder }).then(r => r.data);

// Bandwidth
// The old endpoint was /bandwidth/:vmName, but this panel patch exposes the
// fixed collector under the already-mounted VM router: /vms/:vmName/bandwidth.
// Keep the returned value as an array so the existing chart component can keep
// using data.length / data.map(...) without changes.
const normalizeBandwidthPayload = (payload) => {
  const rows = Array.isArray(payload)
    ? payload
    : (payload?.samples || payload?.data || payload?.points || []);

  return rows.map(row => {
    const inbound = Number(row.inbound_mbps ?? row.MbpsReceived ?? row.rx_mbps ?? row.incoming_mbps ?? row.inbound ?? row.rx ?? 0);
    const outbound = Number(row.outbound_mbps ?? row.MbpsSent ?? row.tx_mbps ?? row.outgoing_mbps ?? row.outbound ?? row.tx ?? 0);
    return {
      ...row,
      timestamp: row.timestamp || row.sample_time || row.created_at || row.time,
      sample_time: row.sample_time || row.timestamp || row.created_at || row.time,
      inbound_mbps: inbound,
      outbound_mbps: outbound,
      MbpsReceived: inbound,
      MbpsSent: outbound,
      inbound,
      outbound,
    };
  });
};

export const getBandwidth = (vmName, hours = 24) =>
  api.get(`/vms/${encodeURIComponent(vmName)}/bandwidth`, { params: { hours } })
    .then(r => normalizeBandwidthPayload(r.data));

// Alerts
export const getAlerts = () => api.get('/alerts').then(r => r.data);
export const createAlert = (data) => api.post('/alerts', data).then(r => r.data);
export const updateAlert = (id, data) => api.put(`/alerts/${id}`, data).then(r => r.data);
export const deleteAlert = (id) => api.delete(`/alerts/${id}`).then(r => r.data);
export const getAlertEvents = (limit = 50) => api.get('/alerts/events', { params: { limit } }).then(r => r.data);

// Clients
export const listClients       = ()          => api.get('/clients').then(r => r.data);
export const createClient      = (data)      => api.post('/clients', data).then(r => r.data);
export const getClient         = (id)        => api.get(`/clients/${id}`).then(r => r.data);
export const updateClient      = (id, data)  => api.put(`/clients/${id}`, data).then(r => r.data);
export const deleteClient      = (id)        => api.delete(`/clients/${id}`).then(r => r.data);
export const assignVM          = (id, vm)    => api.post(`/clients/${id}/assign`, { vm_name: vm }).then(r => r.data);
export const unassignVM        = (vm)        => api.delete(`/clients/assignments/${encodeURIComponent(vm)}`).then(r => r.data);
export const getAllAssignments  = ()          => api.get('/clients/assignments/all').then(r => r.data);
export const getUpcomingRenewals = (days=30) => api.get('/clients/renewals/upcoming', { params: { days } }).then(r => r.data);

// Client notes
export const getClientNotes    = (id)            => api.get(`/clients/${id}/notes`).then(r => r.data);
export const createClientNote  = (id, data)      => api.post(`/clients/${id}/notes`, data).then(r => r.data);
export const updateClientNote  = (id, nid, data) => api.put(`/clients/${id}/notes/${nid}`, data).then(r => r.data);
export const deleteClientNote  = (id, nid)       => api.delete(`/clients/${id}/notes/${nid}`).then(r => r.data);

// VM usage report
export const getClientReport   = (id, days=30)   => api.get(`/clients/${id}/report`, { params: { days } }).then(r => r.data);

// Branding
export const saveBranding  = (data) => api.put('/settings/branding', data).then(r => r.data);
export const saveConsoleSettings = (data) => api.put('/settings/console', data).then(r => r.data);

// DDoS Protection
export const getDDoSEvents = (params = {}) => api.get('/ddos/events', { params }).then(r => r.data);
export const getDDoSStats = () => api.get('/ddos/stats').then(r => r.data);
export const getDDoSConfig = () => api.get('/ddos/config').then(r => r.data);
export const updateDDoSConfig = (data) => api.put('/ddos/config', data).then(r => r.data);
export const scanVMForDDoS = (vmName) => api.post(`/ddos/scan/${encodeURIComponent(vmName)}`).then(r => r.data);
export const disconnectVMNetwork = (vmName) => api.post(`/ddos/disconnect/${encodeURIComponent(vmName)}`).then(r => r.data);
export const suspendVMForDDoS = (vmName) => api.post(`/ddos/suspend/${encodeURIComponent(vmName)}`).then(r => r.data);
export const cleanupDDoSEvents = (days = 30) => api.delete('/ddos/events/cleanup', { params: { days } }).then(r => r.data);
