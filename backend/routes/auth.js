const express   = require('express');
const router    = express.Router();
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const QRCode    = require('qrcode');
const https     = require('https');
const { v4: uuidv4 } = require('uuid');
const db        = require('../utils/database');
const { authMiddleware, requireAdmin } = require('../middleware/auth');

const JWT_SECRET      = process.env.JWT_SECRET || 'fallback-secret';
const ACCESS_EXPIRES  = '15m';
const REFRESH_EXPIRES = 7 * 24 * 60 * 60;
const LOCKOUT_ATTEMPTS = 5;
const LOCKOUT_MINUTES  = 15;

function generateAccessToken(user) {
  return jwt.sign({ userId: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: ACCESS_EXPIRES });
}

async function createSession(userId, ip, userAgent) {
  const sessionId    = uuidv4();
  const refreshToken = uuidv4() + uuidv4();
  const expiresAt    = new Date(Date.now() + REFRESH_EXPIRES * 1000).toISOString().slice(0, 19).replace('T', ' ');
  await db.run(
    'INSERT INTO sessions (id, user_id, refresh_token, ip_address, user_agent, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    [sessionId, userId, refreshToken, ip || null, userAgent || null, expiresAt]
  );
  return { sessionId, refreshToken };
}

async function isLockedOut(username, ip) {
  const windowStart = new Date(Date.now() - LOCKOUT_MINUTES * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  const byUser = await db.get('SELECT COUNT(*) AS c FROM login_attempts WHERE username = ? AND success = 0 AND created_at > ?', [username, windowStart]);
  const byIp   = await db.get('SELECT COUNT(*) AS c FROM login_attempts WHERE ip_address = ? AND success = 0 AND created_at > ?', [ip, windowStart]);
  return byUser.c >= LOCKOUT_ATTEMPTS || byIp.c >= LOCKOUT_ATTEMPTS;
}

async function recordAttempt(username, ip, success) {
  await db.run('INSERT INTO login_attempts (username, ip_address, success) VALUES (?, ?, ?)', [username, ip || 'unknown', success ? 1 : 0]);
}

async function clearAttempts(username, ip) {
  await db.run('DELETE FROM login_attempts WHERE username = ? OR ip_address = ?', [username, ip || 'unknown']);
}

function normalizeIp(ip) {
  if (!ip) return '';
  const v = String(ip).trim();
  if (v.startsWith('::ffff:')) return v.slice(7);
  return v === '::1' ? '127.0.0.1' : v;
}

function isPrivateIp(ip) {
  if (!ip) return true;
  if (ip === '127.0.0.1' || ip === '::1') return true;
  return /^10\./.test(ip)
    || /^192\.168\./.test(ip)
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)
    || /^169\.254\./.test(ip);
}

function fetchJson(url, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: timeoutMs }, (resp) => {
      let data = '';
      resp.on('data', c => { data += c; });
      resp.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

async function lookupGeo(ip) {
  const normalized = normalizeIp(ip);
  if (!normalized || isPrivateIp(normalized)) return null;
  const payload = await fetchJson(`https://ipapi.co/${encodeURIComponent(normalized)}/json/`);
  if (!payload || payload.error) return null;
  return {
    ip: normalized,
    country_code: payload.country_code || null,
    asn: payload.asn || null,
  };
}

async function checkLoginRisk(userId, ip) {
  const geo = await lookupGeo(ip);
  if (!geo) return null;
  const recent = await db.all(
    `SELECT country_code, asn
     FROM login_risk_events
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT 10`,
    [userId]
  );
  const hasCountryMatch = recent.some(r => r.country_code && r.country_code === geo.country_code);
  const hasAsnMatch = recent.some(r => r.asn && r.asn === geo.asn);
  const matureHistory = recent.length >= 3;
  if (!matureHistory) {
    await db.run(
      `INSERT INTO login_risk_events (user_id, ip_address, country_code, asn, risk_level, reason)
       VALUES (?, ?, ?, ?, 'low', 'baseline')`,
      [userId, geo.ip, geo.country_code, geo.asn]
    );
    return null;
  }
  let reason = null;
  if (!hasCountryMatch && geo.country_code) reason = 'new_country';
  else if (!hasAsnMatch && geo.asn) reason = 'new_asn';
  await db.run(
    `INSERT INTO login_risk_events (user_id, ip_address, country_code, asn, risk_level, reason)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, geo.ip, geo.country_code, geo.asn, reason ? 'medium' : 'low', reason || 'baseline']
  );
  return reason ? { ...geo, reason } : null;
}

// ─── Login ────────────────────────────────────────────────────────────────────

router.post('/login', async (req, res) => {
  const { username, password, totp_code } = req.body;
  const ip = normalizeIp(req.ip), ua = req.headers['user-agent'] || '';
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  if (await isLockedOut(username, ip)) {
    await db.run("INSERT INTO audit_logs (username, action, details, status, ip_address) VALUES (?, 'LOGIN', 'Locked out', 'failure', ?)", [username, ip]);
    return res.status(429).json({ error: `Too many failed attempts. Try again in ${LOCKOUT_MINUTES} minutes.`, locked: true });
  }

  const user = await db.get('SELECT * FROM users WHERE username = ?', [username]);
  if (!user) { await recordAttempt(username, ip, false); return res.status(401).json({ error: 'Invalid credentials' }); }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    await recordAttempt(username, ip, false);
    await db.run("INSERT INTO audit_logs (user_id, username, action, details, status, ip_address) VALUES (?, ?, 'LOGIN', 'Bad password', 'failure', ?)", [user.id, username, ip]);
    const windowStart = new Date(Date.now() - LOCKOUT_MINUTES * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    const { c } = await db.get('SELECT COUNT(*) AS c FROM login_attempts WHERE username = ? AND success = 0 AND created_at > ?', [username, windowStart]);
    const remaining = LOCKOUT_ATTEMPTS - c;
    return res.status(401).json({ error: remaining > 0 ? `Invalid credentials. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.` : `Too many attempts. Try again in ${LOCKOUT_MINUTES} minutes.` });
  }

  const totpRow = await db.get('SELECT * FROM totp_secrets WHERE user_id = ? AND verified = 1', [user.id]);
  if (totpRow) {
    if (!totp_code) return res.status(200).json({ requires_2fa: true });
    const verified = speakeasy.totp.verify({ secret: totpRow.secret, encoding: 'base32', token: totp_code, window: 1 });
    if (!verified) {
      await recordAttempt(username, ip, false);
      return res.status(401).json({ error: 'Invalid 2FA code', requires_2fa: true });
    }
  }

  await clearAttempts(username, ip);
  await db.run('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);
  await db.run("INSERT INTO audit_logs (user_id, username, action, details, status, ip_address) VALUES (?, ?, 'LOGIN', 'Success', 'success', ?)", [user.id, username, ip]);
  const risk = await checkLoginRisk(user.id, ip);
  if (risk) {
    await db.run(
      "INSERT INTO audit_logs (user_id, username, action, details, status, ip_address) VALUES (?, ?, 'LOGIN_ANOMALY', ?, 'warning', ?)",
      [user.id, username, `Detected ${risk.reason} (${risk.country_code || 'unknown'} / ${risk.asn || 'unknown'})`, ip]
    );
  }

  const accessToken = generateAccessToken(user);
  const { sessionId, refreshToken } = await createSession(user.id, ip, ua);
  res.json({
    token: accessToken,
    refresh_token: refreshToken,
    session_id: sessionId,
    user: { id: user.id, username: user.username, role: user.role, discord_id: user.discord_id || null },
    totp_enabled: !!totpRow,
    security_notice: risk ? 'Unusual login location detected.' : null,
  });
});

// ─── Refresh ──────────────────────────────────────────────────────────────────

router.post('/refresh', async (req, res) => {
  const { refresh_token } = req.body;
  if (!refresh_token) return res.status(400).json({ error: 'refresh_token required' });
  const session = await db.get(
    `SELECT s.*, u.username, u.role FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.refresh_token = ? AND s.revoked = 0 AND s.expires_at > NOW()`, [refresh_token]);
  if (!session) return res.status(401).json({ error: 'Invalid or expired refresh token' });

  const newRefresh = uuidv4() + uuidv4();
  const newExpiry  = new Date(Date.now() + REFRESH_EXPIRES * 1000).toISOString().slice(0, 19).replace('T', ' ');
  await db.run('UPDATE sessions SET refresh_token = ?, expires_at = ? WHERE id = ?', [newRefresh, newExpiry, session.id]);
  res.json({ token: generateAccessToken({ id: session.user_id, username: session.username, role: session.role }), refresh_token: newRefresh });
});

// ─── Logout ───────────────────────────────────────────────────────────────────

router.post('/logout', authMiddleware, async (req, res) => {
  const { session_id } = req.body;
  if (session_id) await db.run('UPDATE sessions SET revoked = 1 WHERE id = ? AND user_id = ?', [session_id, req.user.id]);
  res.json({ success: true });
});

// ─── Me ───────────────────────────────────────────────────────────────────────

router.get('/me', authMiddleware, async (req, res) => {
  const totpRow = await db.get('SELECT verified FROM totp_secrets WHERE user_id = ?', [req.user.id]);
  res.json({ user: { ...req.user, totp_enabled: !!(totpRow?.verified) } });
});

router.put('/me/discord', authMiddleware, async (req, res) => {
  const raw = String(req.body?.discord_id || '').trim();
  if (!/^\d{17,20}$/.test(raw)) return res.status(400).json({ error: 'Invalid Discord ID' });
  try {
    await db.run('UPDATE users SET discord_id = ? WHERE id = ?', [raw, req.user.id]);
    res.json({ success: true, discord_id: raw });
  } catch {
    res.status(409).json({ error: 'Discord ID already linked to another user' });
  }
});

router.put('/me/password', authMiddleware, async (req, res) => {
  const currentPassword = String(req.body?.current_password || '');
  const newPassword = String(req.body?.new_password || '');
  if (!currentPassword) return res.status(400).json({ error: 'Current password is required' });
  if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });

  const user = await db.get('SELECT id, username, password_hash FROM users WHERE id = ?', [req.user.id]);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const valid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!valid) {
    await db.run(
      "INSERT INTO audit_logs (user_id, username, action, details, status, ip_address) VALUES (?, ?, 'PASSWORD_CHANGE', 'Incorrect current password', 'failure', ?)",
      [req.user.id, req.user.username, req.ip]
    );
    return res.status(401).json({ error: 'Current password is incorrect' });
  }

  const sameAsCurrent = await bcrypt.compare(newPassword, user.password_hash);
  if (sameAsCurrent) return res.status(400).json({ error: 'New password must be different from current password' });

  const hash = await bcrypt.hash(newPassword, 12);
  await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.user.id]);
  await db.run('UPDATE sessions SET revoked = 1 WHERE user_id = ?', [req.user.id]);
  await db.run(
    "INSERT INTO audit_logs (user_id, username, action, details, status, ip_address) VALUES (?, ?, 'PASSWORD_CHANGE', 'Password changed by user', 'success', ?)",
    [req.user.id, req.user.username, req.ip]
  );
  res.json({ success: true });
});

// ─── Sessions ─────────────────────────────────────────────────────────────────

router.get('/sessions', authMiddleware, async (req, res) => {
  const sessions = await db.all(
    'SELECT id, ip_address, user_agent, created_at, last_active, expires_at, revoked FROM sessions WHERE user_id = ? AND revoked = 0 AND expires_at > NOW() ORDER BY last_active DESC',
    [req.user.id]);
  res.json(sessions);
});

router.get('/sessions/all', authMiddleware, requireAdmin, async (req, res) => {
  const sessions = await db.all(
    `SELECT s.id, s.ip_address, s.user_agent, s.created_at, s.last_active, s.expires_at, u.id AS user_id, u.username
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.revoked = 0 AND s.expires_at > NOW() ORDER BY s.last_active DESC`);
  res.json(sessions);
});

router.delete('/sessions/:id', authMiddleware, async (req, res) => {
  const session = await db.get('SELECT * FROM sessions WHERE id = ?', [req.params.id]);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (req.user.role !== 'admin' && session.user_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });
  await db.run('UPDATE sessions SET revoked = 1 WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

router.delete('/sessions/user/:userId', authMiddleware, requireAdmin, async (req, res) => {
  await db.run('UPDATE sessions SET revoked = 1 WHERE user_id = ?', [parseInt(req.params.userId)]);
  res.json({ success: true });
});

// ─── 2FA ──────────────────────────────────────────────────────────────────────

router.post('/2fa/setup', authMiddleware, async (req, res) => {
  const existing = await db.get('SELECT * FROM totp_secrets WHERE user_id = ?', [req.user.id]);
  if (existing?.verified) return res.status(400).json({ error: '2FA is already enabled. Disable it first.' });
  const secret = speakeasy.generateSecret({ name: `HyperV Panel (${req.user.username})`, length: 20 });
  await db.run(
    'INSERT INTO totp_secrets (user_id, secret, verified) VALUES (?, ?, 0) ON DUPLICATE KEY UPDATE secret = ?, verified = 0',
    [req.user.id, secret.base32, secret.base32]);
  const qr = await QRCode.toDataURL(secret.otpauth_url);
  res.json({ secret: secret.base32, qr });
});

router.post('/2fa/verify', authMiddleware, async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'code required' });
  const row = await db.get('SELECT * FROM totp_secrets WHERE user_id = ?', [req.user.id]);
  if (!row) return res.status(400).json({ error: 'No 2FA setup in progress' });
  const valid = speakeasy.totp.verify({ secret: row.secret, encoding: 'base32', token: code, window: 1 });
  if (!valid) return res.status(400).json({ error: 'Invalid code. Try again.' });
  await db.run('UPDATE totp_secrets SET verified = 1 WHERE user_id = ?', [req.user.id]);
  await db.run("INSERT INTO audit_logs (user_id, username, action, details, status, ip_address) VALUES (?, ?, '2FA_ENABLED', '2FA enabled', 'success', ?)", [req.user.id, req.user.username, req.ip]);
  res.json({ success: true });
});

router.delete('/2fa', authMiddleware, async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password required to disable 2FA' });
  const user = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Incorrect password' });
  await db.run('DELETE FROM totp_secrets WHERE user_id = ?', [req.user.id]);
  await db.run("INSERT INTO audit_logs (user_id, username, action, details, status, ip_address) VALUES (?, ?, '2FA_DISABLED', '2FA disabled', 'success', ?)", [req.user.id, req.user.username, req.ip]);
  res.json({ success: true });
});

// ─── Users CRUD ───────────────────────────────────────────────────────────────

router.post('/users', authMiddleware, requireAdmin, async (req, res) => {
  const { username, password, role = 'user' } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (!['admin', 'user'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const existing = await db.get('SELECT id FROM users WHERE username = ?', [username]);
  if (existing) return res.status(409).json({ error: 'Username already exists' });
  const hash = await bcrypt.hash(password, 12);
  const { insertId } = await db.run('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)', [username, hash, role]);
  res.status(201).json({ id: insertId, username, role });
});

router.get('/users', authMiddleware, requireAdmin, async (req, res) => {
  const users = await db.all('SELECT id, username, discord_id, role, created_at, last_login FROM users ORDER BY created_at');
  const totpRows = await db.all('SELECT user_id FROM totp_secrets WHERE verified = 1');
  const totpSet = new Set(totpRows.map(r => r.user_id));
  res.json(users.map(u => ({ ...u, totp_enabled: totpSet.has(u.id) })));
});

router.put('/users/:id/discord', authMiddleware, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  const raw = String(req.body?.discord_id || '').trim();
  const discordId = raw.length === 0 ? null : raw;
  if (discordId && !/^\d{17,20}$/.test(discordId)) return res.status(400).json({ error: 'Invalid Discord ID' });
  try {
    await db.run('UPDATE users SET discord_id = ? WHERE id = ?', [discordId, id]);
    res.json({ success: true, discord_id: discordId });
  } catch {
    res.status(409).json({ error: 'Discord ID already linked to another user' });
  }
});

router.get('/discord/whitelist', authMiddleware, requireAdmin, async (req, res) => {
  const rows = await db.all(
    `SELECT w.discord_id, w.note, w.created_at, w.created_by, u.username AS created_by_username
     FROM discord_whitelist w
     LEFT JOIN users u ON u.id = w.created_by
     ORDER BY w.created_at DESC`
  );
  res.json(rows);
});

router.post('/discord/whitelist', authMiddleware, requireAdmin, async (req, res) => {
  const discordId = String(req.body?.discord_id || '').trim();
  const note = String(req.body?.note || '').slice(0, 255);
  if (!/^\d{17,20}$/.test(discordId)) return res.status(400).json({ error: 'Invalid Discord ID' });
  await db.run(
    `INSERT INTO discord_whitelist (discord_id, note, created_by)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE note = VALUES(note), created_by = VALUES(created_by)`,
    [discordId, note || null, req.user.id]
  );
  res.json({ success: true });
});

router.delete('/discord/whitelist/:discordId', authMiddleware, requireAdmin, async (req, res) => {
  await db.run('DELETE FROM discord_whitelist WHERE discord_id = ?', [req.params.discordId]);
  res.json({ success: true });
});

router.delete('/users/:id', authMiddleware, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'Cannot delete your own account' });
  try {
    await db.run('DELETE FROM user_vm_access WHERE user_id = ?', [id]);
    await db.run('UPDATE audit_logs SET user_id = NULL WHERE user_id = ?', [id]);
    await db.run('UPDATE scheduled_tasks SET created_by = NULL WHERE created_by = ?', [id]);
    await db.run('DELETE FROM sessions WHERE user_id = ?', [id]);
    await db.run('DELETE FROM totp_secrets WHERE user_id = ?', [id]);
    await db.run('DELETE FROM users WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/users/:id/password', authMiddleware, async (req, res) => {
  const id = parseInt(req.params.id);
  if (req.user.role !== 'admin' && req.user.id !== id) return res.status(403).json({ error: 'Not authorized' });
  const { password } = req.body;
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const hash = await bcrypt.hash(password, 12);
  await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, id]);
  await db.run('UPDATE sessions SET revoked = 1 WHERE user_id = ?', [id]);
  res.json({ success: true });
});

router.put('/users/:id/role', authMiddleware, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  const { role } = req.body || {};
  if (!['admin', 'user'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (id === req.user.id && role !== 'admin') return res.status(400).json({ error: 'Cannot change your own admin role' });
  try {
    await db.run('UPDATE users SET role = ? WHERE id = ?', [role, id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/users/:id/vms', authMiddleware, requireAdmin, async (req, res) => {
  const rows = await db.all('SELECT vm_name FROM user_vm_access WHERE user_id = ? ORDER BY vm_name', [parseInt(req.params.id)]);
  res.json(rows.map(r => r.vm_name));
});

router.post('/users/:id/vms', authMiddleware, requireAdmin, async (req, res) => {
  const { vm_name } = req.body || {};
  if (!vm_name) return res.status(400).json({ error: 'vm_name is required' });
  try {
    await db.run('INSERT IGNORE INTO user_vm_access (user_id, vm_name) VALUES (?, ?)', [parseInt(req.params.id), vm_name]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/users/:id/vms/:vm_name', authMiddleware, requireAdmin, async (req, res) => {
  try {
    await db.run('DELETE FROM user_vm_access WHERE user_id = ? AND vm_name = ?', [parseInt(req.params.id), req.params.vm_name]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
