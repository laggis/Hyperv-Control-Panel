const express = require('express');
const router  = express.Router();
const ps      = require('../utils/powershell');
const db      = require('../utils/database');
const rdpConsole = require('../utils/rdpConsole');
const { authMiddleware, requireOperator, requireAdmin, requireOperatorOrAssignedViewer } = require('../middleware/auth');
const { auditLog } = require('../middleware/audit');



// ─── Email notification helpers ──────────────────────────────────────────────
// Stores per-panel-user email preferences and sends "server stopped" emails
// through the SMTP settings that already exist in the panel settings table.
async function ensureEmailNotificationTable() {
  await db.run(`CREATE TABLE IF NOT EXISTS user_email_notifications (
    user_id INT NOT NULL PRIMARY KEY,
    email VARCHAR(320) NOT NULL,
    notify_stopped TINYINT(1) NOT NULL DEFAULT 1,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function truthy(value) {
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(String(value ?? '').trim().toLowerCase());
}

async function getSettingsMap(keys) {
  if (!keys.length) return {};
  const placeholders = keys.map(() => '?').join(',');
  const rows = await db.all(`SELECT \`key\`, value FROM settings WHERE \`key\` IN (${placeholders})`, keys);
  return Object.fromEntries((rows || []).map(r => [r.key, r.value]));
}

async function getSmtpConfig() {
  const keys = [
    'smtp_enabled', 'smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'smtp_username',
    'smtp_password', 'smtp_pass', 'smtp_from', 'smtp_from_email', 'smtp_from_name',
    'mail_enabled', 'mail_host', 'mail_port', 'mail_secure', 'mail_user', 'mail_password', 'mail_from'
  ];
  const s = await getSettingsMap(keys);
  const env = process.env;
  const pick = (...names) => {
    for (const name of names) {
      if (s[name] !== undefined && s[name] !== null && String(s[name]).trim() !== '') return String(s[name]).trim();
      if (env[name.toUpperCase()] !== undefined && String(env[name.toUpperCase()]).trim() !== '') return String(env[name.toUpperCase()]).trim();
    }
    return '';
  };

  const host = pick('smtp_host', 'mail_host');
  const port = parseInt(pick('smtp_port', 'mail_port') || '587', 10);
  const secureRaw = pick('smtp_secure', 'mail_secure');
  const user = pick('smtp_user', 'smtp_username', 'mail_user');
  const pass = pick('smtp_password', 'smtp_pass', 'mail_password');
  const fromAddress = pick('smtp_from', 'smtp_from_email', 'mail_from') || user;
  const fromName = pick('smtp_from_name') || process.env.APP_NAME || 'Hyper-V Panel';
  const enabledRaw = pick('smtp_enabled', 'mail_enabled');

  return {
    enabled: enabledRaw ? truthy(enabledRaw) : Boolean(host),
    host,
    port: Number.isFinite(port) ? port : 587,
    secure: secureRaw ? truthy(secureRaw) : port === 465,
    auth: user && pass ? { user, pass } : undefined,
    from: fromAddress ? (fromAddress.includes('<') ? fromAddress : `"${fromName.replace(/"/g, '')}" <${fromAddress}>`) : '',
  };
}

async function getPanelUrl(req) {
  const keys = ['panel_url', 'app_url', 'public_url', 'base_url', 'site_url'];
  const s = await getSettingsMap(keys);
  for (const key of keys) {
    if (s[key] && String(s[key]).trim()) return String(s[key]).trim().replace(/\/$/, '');
    const envVal = process.env[key.toUpperCase()];
    if (envVal && String(envVal).trim()) return String(envVal).trim().replace(/\/$/, '');
  }

  if (req) {
    const host = req.get?.('host');
    if (host) {
      const proto = req.get?.('x-forwarded-proto') || req.protocol || 'http';
      return `${proto}://${host}`.replace(/\/$/, '');
    }
  }

  return '';
}

async function sendPanelEmail({ to, subject, text, html }) {
  const result = { enabled: false, sent: false, failed: false, recipient: to, errors: [] };

  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch (err) {
    result.errors.push('nodemailer is not installed. Run: npm install nodemailer');
    return result;
  }

  try {
    const smtp = await getSmtpConfig();
    if (!smtp.enabled || !smtp.host || !smtp.from) {
      result.errors.push('SMTP is not configured or disabled');
      return result;
    }

    result.enabled = true;
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: smtp.auth,
    });

    const info = await transporter.sendMail({
      from: smtp.from,
      to,
      subject,
      text,
      html,
    });

    result.sent = true;
    result.message_id = info?.messageId || null;
    result.accepted = info?.accepted || [];
    result.rejected = info?.rejected || [];
  } catch (err) {
    result.failed = true;
    result.errors.push(err.message);
  }

  return result;
}

async function getStopEmailRecipients(vmName) {
  await ensureEmailNotificationTable();
  const recipients = [];

  // Panel users who enabled stop notifications and have access to this VM.
  const users = await db.all(
    `SELECT DISTINCT n.email, u.username AS name
     FROM user_email_notifications n
     JOIN users u ON u.id = n.user_id
     JOIN user_vm_access a ON a.user_id = n.user_id
     WHERE a.vm_name = ? AND n.notify_stopped = 1 AND n.email <> ''`,
    [vmName]
  );
  recipients.push(...(users || []).map(r => ({ email: r.email, name: r.name || r.email, source: 'user' })));

  // Client contacts already stored on the Clients page, when assigned to this VM.
  try {
    const clients = await db.all(
      `SELECT DISTINCT c.email, COALESCE(NULLIF(c.contact_name, ''), c.name, c.email) AS name
       FROM clients c
       JOIN vm_client_assignments a ON a.client_id = c.id
       WHERE a.vm_name = ? AND c.email IS NOT NULL AND c.email <> ''`,
      [vmName]
    );
    recipients.push(...(clients || []).map(r => ({ email: r.email, name: r.name || r.email, source: 'client' })));
  } catch (err) {
    // Some installs may not have the client manager tables yet. User notifications still work.
    console.warn('[email-notify] Client email lookup skipped:', err.message);
  }

  const seen = new Set();
  return recipients
    .map(r => ({ ...r, email: String(r.email || '').trim() }))
    .filter(r => isValidEmail(r.email))
    .filter(r => {
      const key = r.email.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function notifyVmStopped(vmName, actor) {
  const result = { enabled: false, recipients: 0, sent: 0, failed: 0, errors: [] };

  try {
    const recipients = await getStopEmailRecipients(vmName);
    result.recipients = recipients.length;
    if (!recipients.length) return result;

    const stoppedAt = new Date().toLocaleString('sv-SE', {
      timeZone: process.env.TZ || 'Europe/Stockholm',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const actorName = actor?.username || actor?.email || 'an administrator';

    for (const recipient of recipients) {
      const mailResult = await sendPanelEmail({
        to: recipient.email,
        subject: `Server stopped: ${vmName}`,
        text: [
          `Hello ${recipient.name || ''}`.trim() + ',',
          '',
          `Your server "${vmName}" has been stopped.`,
          `Time: ${stoppedAt}`,
          `Stopped by: ${actorName}`,
          '',
          'If you did not request this, please contact support.',
        ].join('\n'),
        html: `
          <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827">
            <h2 style="margin:0 0 12px">Server stopped</h2>
            <p>Hello ${escapeHtml(recipient.name || '')},</p>
            <p>Your server <strong>${escapeHtml(vmName)}</strong> has been stopped.</p>
            <p><strong>Time:</strong> ${escapeHtml(stoppedAt)}<br><strong>Stopped by:</strong> ${escapeHtml(actorName)}</p>
            <p>If you did not request this, please contact support.</p>
          </div>`,
      });

      if (mailResult.enabled) result.enabled = true;
      if (mailResult.sent) result.sent += 1;
      if (mailResult.failed || mailResult.errors.length) {
        result.failed += 1;
        result.errors.push(`${recipient.email}: ${mailResult.errors.join('; ')}`);
      }
    }
  } catch (err) {
    result.errors.push(err.message);
  }

  return result;
}

async function notifyVmAssigned({ user, vmName, actor, req }) {
  const result = { skipped: false, enabled: false, sent: false, recipient: '', errors: [] };

  await ensureEmailNotificationTable();
  const emailRow = await db.get('SELECT email FROM user_email_notifications WHERE user_id = ?', [user.id]);
  const email = String(emailRow?.email || '').trim();
  result.recipient = email;

  if (!isValidEmail(email)) {
    result.skipped = true;
    result.errors.push('No valid email address saved for this user');
    return result;
  }

  const panelUrl = await getPanelUrl(req);
  const assignedAt = new Date().toLocaleString('sv-SE', {
    timeZone: process.env.TZ || 'Europe/Stockholm',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const actorName = actor?.username || actor?.email || 'an administrator';

  const textLines = [
    `Hello ${user.username || ''}`.trim() + ',',
    '',
    `You have been given access to server "${vmName}" in the Hyper-V panel.`,
    `Username: ${user.username}`,
    panelUrl ? `Panel: ${panelUrl}` : '',
    `Assigned: ${assignedAt}`,
    `Assigned by: ${actorName}`,
    '',
    'For security, your password is not included in this email. Use your existing password or ask support for a reset if you cannot log in.',
  ].filter(Boolean);

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827">
      <h2 style="margin:0 0 12px">Server access assigned</h2>
      <p>Hello ${escapeHtml(user.username || '')},</p>
      <p>You have been given access to server <strong>${escapeHtml(vmName)}</strong> in the Hyper-V panel.</p>
      <p>
        <strong>Username:</strong> ${escapeHtml(user.username || '')}<br>
        ${panelUrl ? `<strong>Panel:</strong> <a href="${escapeHtml(panelUrl)}">${escapeHtml(panelUrl)}</a><br>` : ''}
        <strong>Assigned:</strong> ${escapeHtml(assignedAt)}<br>
        <strong>Assigned by:</strong> ${escapeHtml(actorName)}
      </p>
      <p style="color:#374151">For security, your password is not included in this email. Use your existing password or ask support for a reset if you cannot log in.</p>
    </div>`;

  const mailResult = await sendPanelEmail({
    to: email,
    subject: `Server access assigned: ${vmName}`,
    text: textLines.join('\n'),
    html,
  });

  return { ...result, ...mailResult, recipient: email };
}

async function assertConsoleAccess(req, vmName) {
  if (req.user && (req.user.role === 'user' || req.user.role === 'viewer')) {
    const row = await db.get(
      'SELECT 1 AS ok FROM user_vm_access WHERE user_id = ? AND vm_name = ?',
      [req.user.id, vmName]
    );
    if (!row) {
      const err = new Error('Access denied for this VM');
      err.status = 403;
      throw err;
    }
  }

  const flagRow = await db.get("SELECT value FROM settings WHERE `key` = 'discord_whitelist_enabled'");
  if (String(flagRow?.value || '0') !== '1') return;

  const dbUser = await db.get('SELECT discord_id FROM users WHERE id = ?', [req.user.id]);
  const discordId = dbUser?.discord_id || null;
  if (!discordId) {
    const err = new Error('Discord account must be linked for console access');
    err.status = 403;
    throw err;
  }
  const allowed = await db.get('SELECT 1 AS ok FROM discord_whitelist WHERE discord_id = ?', [discordId]);
  if (!allowed) {
    const err = new Error('Your Discord account is not whitelisted for console access');
    err.status = 403;
    throw err;
  }
}

async function filterVmList(vms, user) {
  const showAllRow = await db.get("SELECT value FROM settings WHERE `key` = 'show_all_vms'");
  const showAll = showAllRow?.value === '1';

  console.log(`[filterVmList] showAll=${showAll}, input VMs count=${vms.length}`);

  if (!showAll) {
    const rootsEnv = (process.env.VM_ROOTS || '').trim();
    const dbRoots = (await db.all('SELECT path FROM vm_roots ORDER BY path')).map(r => r.path);
    const combined = [rootsEnv, ...dbRoots].filter(Boolean).join(';');
    
    console.log(`[filterVmList] VM_ROOTS env: "${rootsEnv}"`);
    console.log(`[filterVmList] DB roots: [${dbRoots.join(', ')}]`);
    console.log(`[filterVmList] Combined: "${combined}"`);
    
    if (combined) {
      const normalize = p => {
        if (!p || typeof p !== 'string') return '';
        let s = p.replace(/\//g, '\\').trim();
        if (s.startsWith('\\\\?\\')) s = s.slice(4);
        while (s.endsWith('\\')) s = s.slice(0, -1);
        return s.toLowerCase();
      };
      const roots = combined.split(';').map(normalize).filter(Boolean);
      console.log(`[filterVmList] Normalized roots: [${roots.join(', ')}]`);
      
      const ok = p => { 
        const lp = normalize(p); 
        const match = roots.some(r => lp === r || lp.startsWith(r + '\\'));
        if (!match) console.log(`[filterVmList] Path "${p}" normalized to "${lp}" - NO MATCH`);
        return match;
      };
      
      const beforeCount = vms.length;
      vms = vms.filter(v => {
        const pathOk = ok(v.Path);
        const configOk = ok(v.ConfigurationLocation);
        const vhdOk = (Array.isArray(v.VHDPaths) ? v.VHDPaths : (v.VHDPaths ? [v.VHDPaths] : [])).some(ok);
        const result = pathOk || configOk || vhdOk;
        
        console.log(`[filterVmList] VM "${v.Name}": Path="${v.Path}", Config="${v.ConfigurationLocation}", VHDs=[${v.VHDPaths}] -> ${result ? 'KEEP' : 'FILTER OUT'}`);
        
        return result;
      });
      console.log(`[filterVmList] Filtered by paths: ${beforeCount} -> ${vms.length} VMs`);
    }
  }

  if (user && (user.role === 'user' || user.role === 'viewer')) {
    const rows = await db.all('SELECT vm_name FROM user_vm_access WHERE user_id = ?', [user.id]);
    const allowed = new Set(rows.map(r => r.vm_name));
    const beforeCount = vms.length;
    vms = vms.filter(v => allowed.has(v.Name));
    console.log(`[filterVmList] Filtered by user access: ${beforeCount} -> ${vms.length} VMs`);
  }

  console.log(`[filterVmList] Final count: ${vms.length}`);
  return vms;
}

// ─── Bandwidth / Network traffic helpers ────────────────────────────────────
// The frontend traffic widget was calling an API endpoint, but the backend did
// not have a working collector/history flow. These helpers create a small sample
// table, pull cumulative Hyper-V network bytes, and calculate Mbps from the
// difference between the newest and previous sample.
async function ensureBandwidthSamplesTable() {
  await db.run(`CREATE TABLE IF NOT EXISTS vm_bandwidth_samples (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    vm_name VARCHAR(255) NOT NULL,
    sample_time DATETIME NOT NULL,
    inbound_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
    outbound_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
    inbound_mbps DOUBLE NOT NULL DEFAULT 0,
    outbound_mbps DOUBLE NOT NULL DEFAULT 0,
    adapters_json LONGTEXT NULL,
    raw_json LONGTEXT NULL,
    INDEX idx_vm_bandwidth_time (vm_name, sample_time)
  )`);
}

function sqlDate(date = new Date()) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function assertVmAccess(req, vmName) {
  if (req.user && (req.user.role === 'user' || req.user.role === 'viewer')) {
    const row = await db.get(
      'SELECT 1 AS ok FROM user_vm_access WHERE user_id = ? AND vm_name = ?',
      [req.user.id, vmName]
    );
    if (!row) {
      const err = new Error('Access denied for this VM');
      err.status = 403;
      throw err;
    }
  }
}

function mapBandwidthRow(row) {
  const inboundMbps = safeNumber(row.inbound_mbps);
  const outboundMbps = safeNumber(row.outbound_mbps);
  const inboundBytes = safeNumber(row.inbound_bytes);
  const outboundBytes = safeNumber(row.outbound_bytes);
  const timestamp = row.timestamp || row.sample_time || row.created_at || new Date().toISOString();

  return {
    timestamp,
    sample_time: timestamp,
    created_at: timestamp,

    inbound_mbps: inboundMbps,
    outbound_mbps: outboundMbps,
    MbpsReceived: inboundMbps,
    MbpsSent: outboundMbps,
    rx_mbps: inboundMbps,
    tx_mbps: outboundMbps,
    incoming_mbps: inboundMbps,
    outgoing_mbps: outboundMbps,
    inbound: inboundMbps,
    outbound: outboundMbps,

    inbound_bytes: inboundBytes,
    outbound_bytes: outboundBytes,
    BytesReceived: inboundBytes,
    BytesSent: outboundBytes,
    inbound_gb: Math.round((inboundBytes / 1073741824) * 1000) / 1000,
    outbound_gb: Math.round((outboundBytes / 1073741824) * 1000) / 1000,
  };
}

async function sampleVmBandwidth(vmName) {
  await ensureBandwidthSamplesTable();

  const latest = await db.get(
    `SELECT id, vm_name, sample_time, inbound_bytes, outbound_bytes, inbound_mbps, outbound_mbps
     FROM vm_bandwidth_samples
     WHERE vm_name = ?
     ORDER BY sample_time DESC
     LIMIT 1`,
    [vmName]
  );

  // The UI says traffic is collected every 60 seconds. Reuse a very recent
  // sample so changing tabs does not spam PowerShell / Hyper-V.
  const minSampleMs = Math.max(10000, parseInt(process.env.BANDWIDTH_SAMPLE_MIN_MS || '55000', 10));
  const latestTime = latest?.sample_time ? new Date(latest.sample_time).getTime() : 0;
  if (latest && Number.isFinite(latestTime) && Date.now() - latestTime < minSampleMs) {
    return { sampled: false, reason: 'recent-sample-reused' };
  }

  const metrics = await ps.getNetworkMetrics(vmName);
  const inboundBytes = Math.max(0, Math.round(safeNumber(metrics.inbound_bytes ?? metrics.BytesReceived ?? metrics.bytes_received)));
  const outboundBytes = Math.max(0, Math.round(safeNumber(metrics.outbound_bytes ?? metrics.BytesSent ?? metrics.bytes_sent)));

  let inboundMbps = 0;
  let outboundMbps = 0;
  if (latest && latestTime) {
    const seconds = Math.max(1, (Date.now() - latestTime) / 1000);
    const prevIn = safeNumber(latest.inbound_bytes);
    const prevOut = safeNumber(latest.outbound_bytes);

    // If Hyper-V resource metering was reset, cumulative counters can go lower.
    // Treat that as a fresh baseline instead of showing a negative spike.
    if (inboundBytes >= prevIn) inboundMbps = ((inboundBytes - prevIn) * 8) / seconds / 1000000;
    if (outboundBytes >= prevOut) outboundMbps = ((outboundBytes - prevOut) * 8) / seconds / 1000000;
  }

  const nowSql = sqlDate(new Date());
  await db.run(
    `INSERT INTO vm_bandwidth_samples
       (vm_name, sample_time, inbound_bytes, outbound_bytes, inbound_mbps, outbound_mbps, adapters_json, raw_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      vmName,
      nowSql,
      inboundBytes,
      outboundBytes,
      Math.round(inboundMbps * 1000) / 1000,
      Math.round(outboundMbps * 1000) / 1000,
      JSON.stringify(metrics.adapters || []),
      JSON.stringify(metrics),
    ]
  );

  // Keep the table small; the widget only uses up to 7 days, but keeping 30 days
  // gives a little buffer for future reports.
  await db.run('DELETE FROM vm_bandwidth_samples WHERE sample_time < ?', [sqlDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))]);

  return { sampled: true };
}

router.use(authMiddleware);

// ─── Static routes MUST come before /:name — Express matches in order ─────────

// GET /vms/roots
router.get('/roots', requireAdmin, async (req, res) => {
  const env    = (process.env.VM_ROOTS || '').trim();
  const envList = env ? env.split(';').map(s => s.trim()).filter(Boolean) : [];
  const dbList  = await db.all('SELECT id, path FROM vm_roots ORDER BY path');
  res.json({ env: envList, db: dbList });
});

// GET /vms/debug-filter - Debug endpoint to see filtering in action
router.get('/debug-filter', requireAdmin, async (req, res) => {
  try {
    const ps = require('../utils/powershell');
    const allVms = await ps.listVMs();
    
    const showAllRow = await db.get("SELECT value FROM settings WHERE `key` = 'show_all_vms'");
    const showAll = showAllRow?.value === '1';
    
    const rootsEnv = (process.env.VM_ROOTS || '').trim();
    const dbRoots = (await db.all('SELECT path FROM vm_roots ORDER BY path')).map(r => r.path);
    const combined = [rootsEnv, ...dbRoots].filter(Boolean).join(';');
    
    const normalize = p => {
      if (!p || typeof p !== 'string') return '';
      let s = p.replace(/\//g, '\\').trim();
      if (s.startsWith('\\\\?\\')) s = s.slice(4);
      while (s.endsWith('\\')) s = s.slice(0, -1);
      return s.toLowerCase();
    };
    
    const roots = combined ? combined.split(';').map(normalize).filter(Boolean) : [];
    
    const debug = {
      showAll,
      vm_roots_env: rootsEnv,
      db_roots: dbRoots,
      combined_roots: combined,
      normalized_roots: roots,
      total_vms: allVms.length,
      vms: allVms.map(v => ({
        name: v.Name,
        path: v.Path,
        path_normalized: normalize(v.Path),
        config: v.ConfigurationLocation,
        config_normalized: normalize(v.ConfigurationLocation),
        vhd_paths: v.VHDPaths,
        matches_root: roots.length === 0 ? null : roots.some(r => {
          const lp = normalize(v.Path);
          const lc = normalize(v.ConfigurationLocation);
          return lp === r || lp.startsWith(r + '\\') || lc === r || lc.startsWith(r + '\\');
        })
      }))
    };
    
    res.json(debug);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// GET /vms/email-manager — admin view of all panel-user stop email settings
router.get('/email-manager', requireAdmin, async (req, res) => {
  try {
    await ensureEmailNotificationTable();
    const rows = await db.all(
      `SELECT u.id, u.username, u.role,
              COALESCE(n.email, '') AS email,
              COALESCE(n.notify_stopped, 0) AS notify_stopped,
              n.updated_at
       FROM users u
       LEFT JOIN user_email_notifications n ON n.user_id = u.id
       ORDER BY u.username ASC`
    );
    res.json(rows.map(r => ({
      ...r,
      notify_stopped: r.notify_stopped === 1 || r.notify_stopped === true,
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /vms/email-manager/users/:userId — admin sets a user's email notification preference
router.put('/email-manager/users/:userId', requireAdmin, async (req, res) => {
  try {
    await ensureEmailNotificationTable();
    const userId = parseInt(req.params.userId, 10);
    if (!Number.isInteger(userId) || userId < 1) return res.status(400).json({ error: 'Invalid user id' });

    const user = await db.get('SELECT id, username FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const email = String(req.body?.email || '').trim();
    const notifyStopped = req.body?.notify_stopped === true || req.body?.notify_stopped === 1 || req.body?.notify_stopped === '1';

    if (!email) {
      await db.run('DELETE FROM user_email_notifications WHERE user_id = ?', [userId]);
      return res.json({ success: true, user_id: userId, email: '', notify_stopped: false });
    }
    if (!isValidEmail(email)) return res.status(400).json({ error: 'Invalid email address' });

    await db.run(
      `INSERT INTO user_email_notifications (user_id, email, notify_stopped)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE email = VALUES(email), notify_stopped = VALUES(notify_stopped)`,
      [userId, email, notifyStopped ? 1 : 0]
    );
    res.json({ success: true, user_id: userId, email, notify_stopped: notifyStopped });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /vms/email-manager/me — signed-in user can view their own notification email
router.get('/email-manager/me', async (req, res) => {
  try {
    await ensureEmailNotificationTable();
    const row = await db.get(
      'SELECT email, notify_stopped, updated_at FROM user_email_notifications WHERE user_id = ?',
      [req.user.id]
    );
    res.json({
      email: row?.email || '',
      notify_stopped: row ? (row.notify_stopped === 1 || row.notify_stopped === true) : false,
      updated_at: row?.updated_at || null,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /vms/email-manager/me — signed-in user can save their own notification email
router.put('/email-manager/me', async (req, res) => {
  try {
    await ensureEmailNotificationTable();
    const email = String(req.body?.email || '').trim();
    const notifyStopped = req.body?.notify_stopped === true || req.body?.notify_stopped === 1 || req.body?.notify_stopped === '1';

    if (!email) {
      await db.run('DELETE FROM user_email_notifications WHERE user_id = ?', [req.user.id]);
      return res.json({ success: true, email: '', notify_stopped: false });
    }
    if (!isValidEmail(email)) return res.status(400).json({ error: 'Invalid email address' });

    await db.run(
      `INSERT INTO user_email_notifications (user_id, email, notify_stopped)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE email = VALUES(email), notify_stopped = VALUES(notify_stopped)`,
      [req.user.id, email, notifyStopped ? 1 : 0]
    );
    res.json({ success: true, email, notify_stopped: notifyStopped });
  } catch (err) { res.status(500).json({ error: err.message }); }
});


// POST /vms/email-manager/test-smtp — sends a real test email using current SMTP settings
router.post('/email-manager/test-smtp', requireAdmin, async (req, res) => {
  try {
    const to = String(req.body?.to || '').trim();
    if (!isValidEmail(to)) return res.status(400).json({ success: false, error: 'Please enter a valid test email address' });

    const smtp = await getSmtpConfig();
    const safeConfig = {
      enabled: !!smtp.enabled,
      host: smtp.host || '',
      port: smtp.port,
      secure: !!smtp.secure,
      from: smtp.from || '',
      auth_configured: !!smtp.auth,
      auth_user: smtp.auth?.user || '',
    };

    if (!smtp.enabled || !smtp.host || !smtp.from) {
      return res.status(400).json({
        success: false,
        sent: false,
        error: 'SMTP is not configured or is disabled. Check SMTP host, from address, and enabled setting.',
        config: safeConfig,
      });
    }

    const sentAt = new Date().toLocaleString('sv-SE', {
      timeZone: process.env.TZ || 'Europe/Stockholm',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });

    const mailResult = await sendPanelEmail({
      to,
      subject: 'SMTP test from Hyper-V Panel',
      text: [
        'Hello,',
        '',
        'This is a test email from your Hyper-V Panel SMTP configuration.',
        `Sent: ${sentAt}`,
        '',
        'If you received this email, SMTP sending is working.',
      ].join('\n'),
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827">
          <h2 style="margin:0 0 12px">SMTP test successful</h2>
          <p>This is a test email from your Hyper-V Panel SMTP configuration.</p>
          <p><strong>Sent:</strong> ${escapeHtml(sentAt)}</p>
          <p>If you received this email, SMTP sending is working.</p>
        </div>`,
    });

    const status = mailResult.sent ? 200 : 500;
    res.status(status).json({
      success: !!mailResult.sent,
      sent: !!mailResult.sent,
      to,
      config: safeConfig,
      message_id: mailResult.message_id || null,
      accepted: mailResult.accepted || [],
      rejected: mailResult.rejected || [],
      errors: mailResult.errors || [],
      error: mailResult.errors?.join('; ') || undefined,
    });
  } catch (err) {
    res.status(500).json({ success: false, sent: false, error: err.message });
  }
});

// POST /vms/:name/test-stop-email — admin-only test without stopping the VM
router.post('/:name/test-stop-email', requireAdmin, async (req, res) => {
  try {
    const result = await notifyVmStopped(req.params.name, req.user);
    res.json({ success: true, vm: req.params.name, email_notifications: result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /vms/email-manager/users/:userId/vms — assign a VM to a panel user
// and email the assigned server info to the user's saved email address.
router.post('/email-manager/users/:userId/vms', requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    const vmName = String(req.body?.vm_name || '').trim();
    const sendEmail = req.body?.send_email !== false && req.body?.send_assignment_email !== false;

    if (!Number.isInteger(userId) || userId < 1) return res.status(400).json({ error: 'Invalid user id' });
    if (!vmName) return res.status(400).json({ error: 'vm_name is required' });

    const user = await db.get('SELECT id, username, role FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // INSERT IGNORE prevents a duplicate access row from breaking the UI when the
    // admin saves a VM that was already assigned.
    await db.run('INSERT IGNORE INTO user_vm_access (user_id, vm_name) VALUES (?, ?)', [userId, vmName]);

    const payload = { success: true, user_id: userId, vm_name: vmName, email_assignment: null };
    if (sendEmail) {
      payload.email_assignment = await notifyVmAssigned({ user, vmName, actor: req.user, req });
    }

    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/roots', requireAdmin, async (req, res) => {
  const p = (req.body?.path || '').trim();
  if (!p) return res.status(400).json({ error: 'path is required' });
  try {
    const { insertId } = await db.run('INSERT INTO vm_roots (path) VALUES (?)', [p]);
    res.status(201).json({ id: insertId, path: p });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /vms/names — ultra-fast name list for assignment dropdowns (no VHD pass, no metrics)
// Returns { Name, State, is_assigned } for every VM on the host.
router.get('/names', requireAdmin, async (req, res) => {
  try {
    const [vms, userAssignments, clientAssignments] = await Promise.all([
      ps.listVMNames(),
      db.all('SELECT DISTINCT vm_name FROM user_vm_access'),
      db.all('SELECT DISTINCT vm_name FROM vm_client_assignments'),
    ]);
    const assigned = new Set([
      ...userAssignments.map(r => r.vm_name),
      ...clientAssignments.map(r => r.vm_name),
    ]);
    res.json(vms.map(vm => ({
      Name:        vm.Name,
      State:       vm.State,
      is_assigned: assigned.has(vm.Name),
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /vms/discover — list ALL VMs from Hyper-V (for admin to manually assign)
router.get('/discover', requireAdmin, async (req, res) => {
  try {
    // Query Hyper-V directly for all VMs
    const allVMs = await ps.listVMs();
    
    // Get list of already assigned VMs
    const userAssignments = await db.all('SELECT DISTINCT vm_name FROM user_vm_access');
    const clientAssignments = await db.all('SELECT DISTINCT vm_name FROM vm_client_assignments');
    const assigned = new Set([
      ...userAssignments.map(r => r.vm_name),
      ...clientAssignments.map(r => r.vm_name)
    ]);

    // Mark each VM as assigned or unassigned
    const vmsWithStatus = allVMs.map(vm => ({
      ...vm,
      is_assigned: assigned.has(vm.Name)
    }));

    res.json(vmsWithStatus);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/roots/:id', requireAdmin, async (req, res) => {
  try { await db.run('DELETE FROM vm_roots WHERE id = ?', [parseInt(req.params.id)]); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /vms — query ONLY assigned VMs directly from Hyper-V (fast!)
router.get('/', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    
    // Get list of VMs assigned to this user (or all if admin/operator)
    let assignedVmNames = [];
    
    if (req.user.role === 'admin' || req.user.role === 'operator') {
      // Admins/operators see all assigned VMs (from both user and client assignments)
      const userAssignments = await db.all('SELECT DISTINCT vm_name FROM user_vm_access');
      const clientAssignments = await db.all('SELECT DISTINCT vm_name FROM vm_client_assignments');
      assignedVmNames = [
        ...userAssignments.map(r => r.vm_name),
        ...clientAssignments.map(r => r.vm_name)
      ];
    } else {
      // Regular users/viewers only see their assigned VMs
      const rows = await db.all('SELECT vm_name FROM user_vm_access WHERE user_id = ?', [req.user.id]);
      assignedVmNames = rows.map(r => r.vm_name);
    }

    if (assignedVmNames.length === 0) {
      return res.json([]);
    }

    // Query ONLY the specific assigned VMs — much faster than Get-VM | Get-VMHardDiskDrive on all VMs
    let vms = await ps.listSpecificVMs(assignedVmNames);
    
    // Apply additional filters (VM roots, etc.)
    vms = await filterVmList(vms, req.user);

    res.json(vms);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /vms/:name/bandwidth — traffic history for the Network Traffic widget
router.get('/:name/bandwidth', requireOperatorOrAssignedViewer, async (req, res) => {
  try {
    await assertVmAccess(req, req.params.name);

    const hoursRaw = parseInt(req.query.hours || '24', 10);
    const hours = Math.min(24 * 30, Math.max(1, Number.isFinite(hoursRaw) ? hoursRaw : 24));

    await sampleVmBandwidth(req.params.name);

    const since = sqlDate(new Date(Date.now() - hours * 60 * 60 * 1000));
    const rows = await db.all(
      `SELECT sample_time AS timestamp, inbound_bytes, outbound_bytes, inbound_mbps, outbound_mbps
       FROM vm_bandwidth_samples
       WHERE vm_name = ? AND sample_time >= ?
       ORDER BY sample_time ASC`,
      [req.params.name, since]
    );

    // Return an array for the existing chart, with many alias field names so it
    // works with the old frontend mapper and the new normalized api.js mapper.
    res.json((rows || []).map(mapBandwidthRow));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (err.message.includes('Invalid VM name')) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// GET /vms/:name
router.get('/:name', async (req, res) => {
  try {
    if (req.user && (req.user.role === 'user' || req.user.role === 'viewer')) {
      const row = await db.get('SELECT 1 AS ok FROM user_vm_access WHERE user_id = ? AND vm_name = ?', [req.user.id, req.params.name]);
      if (!row) return res.status(403).json({ error: 'Access denied for this VM' });
    }
    res.json(await ps.getVMDetails(req.params.name));
  } catch (err) {
    if (err.message.includes('Invalid VM name')) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

const vmAction = (fn, action) => [requireOperatorOrAssignedViewer, auditLog({ action }), async (req, res) => {
  try {
    await fn(req);

    const payload = { success: true, action, vm: req.params.name };

    // After a VM stop succeeds, notify panel users/client contacts that are attached to that VM.
    // Email errors are returned in the response but do not roll back the stop action.
    if (action === 'VM_STOP') {
      payload.email_notifications = await notifyVmStopped(req.params.name, req.user);
    }

    res.json(payload);
  } catch (err) {
    if (err.message.includes('Invalid VM name')) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
}];

router.post('/:name/start',   ...vmAction(req => ps.startVM(req.params.name), 'VM_START'));
router.post('/:name/stop',    ...vmAction(req => ps.stopVM(req.params.name, req.body?.force === true), 'VM_STOP'));
router.post('/:name/restart', ...vmAction(req => ps.restartVM(req.params.name, req.body?.force === true), 'VM_RESTART'));
router.post('/:name/suspend', ...vmAction(req => ps.suspendVM(req.params.name), 'VM_SUSPEND'));
router.post('/:name/resume',  ...vmAction(req => ps.resumeVM(req.params.name), 'VM_RESUME'));

// Snapshots
router.get('/:name/snapshots', async (req, res) => {
  try {
    if (req.user && (req.user.role === 'user' || req.user.role === 'viewer')) {
      const row = await db.get('SELECT 1 AS ok FROM user_vm_access WHERE user_id = ? AND vm_name = ?', [req.user.id, req.params.name]);
      if (!row) return res.status(403).json({ error: 'Access denied for this VM' });
    }
    res.json(await ps.listSnapshots(req.params.name));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:name/snapshots', requireOperator, auditLog({ action: 'SNAPSHOT_CREATE' }), async (req, res) => {
  const { snapshotName } = req.body;
  if (!snapshotName) return res.status(400).json({ error: 'snapshotName is required' });
  try {
    const maxSnapshots = Math.max(1, parseInt(process.env.MAX_VM_SNAPSHOTS || '20', 10));
    const existing = await ps.listSnapshots(req.params.name);
    if (existing.length >= maxSnapshots) {
      return res.status(400).json({ error: `Snapshot limit reached (${maxSnapshots}). Delete old snapshots first.` });
    }
    await ps.createSnapshot(req.params.name, snapshotName);
    res.json({ success: true });
  } catch (err) {
    if (err.message.includes('Invalid')) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.post('/:name/snapshots/:snapshotName/restore', requireOperator, auditLog({ action: 'SNAPSHOT_RESTORE' }), async (req, res) => {
  try {
    const vm = await ps.getVMDetails(req.params.name);
    const force = req.body?.force === true;
    if (vm?.State === 'Running' && !force) {
      return res.status(409).json({ error: 'VM is running. Stop the VM or retry with force=true.' });
    }
    await ps.restoreSnapshot(req.params.name, req.params.snapshotName);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:name/snapshots/:snapshotName', requireOperator, auditLog({ action: 'SNAPSHOT_DELETE' }), async (req, res) => {
  try { await ps.deleteSnapshot(req.params.name, req.params.snapshotName); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Password reset
router.post('/:name/reset-password', requireOperator, auditLog({ action: 'VM_RESET_PASSWORD' }), async (req, res) => {
  const { guestUser, guestPassword, targetUser, newPassword } = req.body || {};
  if (!guestUser || !guestPassword || !targetUser || !newPassword)
    return res.status(400).json({ error: 'guestUser, guestPassword, targetUser, and newPassword are all required' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
  try { await ps.resetVMPassword(req.params.name, guestUser, guestPassword, targetUser, newPassword); res.json({ success: true }); }
  catch (err) {
    if (err.message.includes('Invalid') || err.message.includes('disallowed')) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// Emergency reset
router.post('/:name/emergency-reset-password', requireAdmin, auditLog({ action: 'VM_EMERGENCY_RESET_PASSWORD' }), async (req, res) => {
  const { targetUser, newPassword, restartAfter = true } = req.body || {};
  if (!targetUser || !newPassword) return res.status(400).json({ error: 'targetUser and newPassword are required' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
  req.setTimeout(300000);
  res.setTimeout(300000);
  try {
    const output = await ps.emergencyResetVMPassword(req.params.name, targetUser, newPassword, restartAfter === true || restartAfter === 'true');
    res.json({ success: true, detail: output });
  } catch (err) {
    if (err.message.includes('Invalid') || err.message.includes('disallowed')) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// GET /vms/:name/rdp-info
router.get('/:name/rdp-info', async (req, res) => {
  try {
    const guid = await ps.getVMGuid(req.params.name);
    res.json({ vmName: req.params.name, guid });
  } catch (err) {
    if (err.message.includes('Invalid VM name')) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// GET /vms/:name/console-session
router.get('/:name/console-session', async (req, res) => {
  try {
    await assertConsoleAccess(req, req.params.name);

    const override = await db.get(
      'SELECT rdp_port, rdp_host, rdp_username, rdp_password, use_manual FROM vm_console_overrides WHERE vm_name = ?',
      [req.params.name]
    );
    const useManual = override?.use_manual === 1;

    let mode, port;
    if (useManual && override?.rdp_host) {
      const setting = await db.get("SELECT value FROM settings WHERE `key` = 'console_rdp_port'");
      port = String(override?.rdp_port || setting?.value || '3389');
      mode = 'rdp';
    } else {
      await ps.getVMGuid(req.params.name);
      mode = 'vmconnect';
      port = '2179';
    }

    res.json({
      mode,
      ws_path: rdpConsole.getWsPath(),
      vm_name: req.params.name,
      use_manual: useManual,
      rdp_host: useManual ? (override?.rdp_host || '') : null,
      port,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (err.message.includes('Invalid VM name')) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// GET /vms/:name/console-url
router.get('/:name/console-url', async (req, res) => {
  try {
    await assertConsoleAccess(req, req.params.name);

    const settingsRows = await db.all(
      "SELECT `key`, value FROM settings WHERE `key` IN ('console_url_template', 'console_rdp_port')"
    );
    const settings = Object.fromEntries(settingsRows.map(r => [r.key, r.value]));
    const template = String(settings.console_url_template || '').trim();
    const defaultPort = settings.console_rdp_port || '3389';

    const override = await db.get(
      'SELECT rdp_port, rdp_host, rdp_username, use_manual FROM vm_console_overrides WHERE vm_name = ?',
      [req.params.name]
    );

    const useManual = override?.use_manual === 1;
    const rdpPort = String(override?.rdp_port || defaultPort).trim();
    const rdpUsername = override?.rdp_username || '';

    let targetHost = '', vmIP = '';
    if (useManual && override?.rdp_host) {
      targetHost = override.rdp_host;
    } else {
      const vm = await ps.getVMDetails(req.params.name);
      if (vm.NetworkAdapters?.length) {
        for (const nic of vm.NetworkAdapters) {
          const ips = Array.isArray(nic.IPAddresses) ? nic.IPAddresses : (nic.IPAddresses ? nic.IPAddresses.split(',') : []);
          const ipv4 = ips.map(ip => String(ip || '').trim()).find(ip =>
            /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip) && !ip.startsWith('169.254') && ip !== '127.0.0.1'
          );
          if (ipv4) { vmIP = ipv4; break; }
        }
      }
      targetHost = vmIP;
    }

    if (!targetHost) {
      return res.status(400).json({
        error: useManual
          ? 'Manual RDP host is not configured. Set it in the console settings tab.'
          : 'VM IP not detected. Make sure VM is running and Integration Services are enabled, or configure a manual host.'
      });
    }

    if (!template) {
      return res.status(400).json({ error: 'Browser RDP is not configured. Set a console URL template in Settings.' });
    }

    const finalUrl = template
      .replaceAll('{host}', encodeURIComponent(targetHost))
      .replaceAll('{port}', encodeURIComponent(rdpPort))
      .replaceAll('{vm}', encodeURIComponent(req.params.name))
      .replaceAll('{username}', encodeURIComponent(rdpUsername));

    res.json({ url: finalUrl, vmIP: useManual ? null : vmIP, rdp_host: targetHost, port: rdpPort, username: rdpUsername, use_manual: useManual });
  } catch (err) {
    if (err.message.includes('Invalid VM name')) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// GET /vms/:name/console-config
router.get('/:name/console-config', requireOperatorOrAssignedViewer, async (req, res) => {
  try {
    const setting = await db.get("SELECT value FROM settings WHERE `key` = 'console_rdp_port'");
    const defaultPort = String(setting?.value || '3389');

    const vm = await ps.getVMDetails(req.params.name);
    let autoIP = '';
    if (vm.NetworkAdapters?.length) {
      for (const nic of vm.NetworkAdapters) {
        const ips = Array.isArray(nic.IPAddresses) ? nic.IPAddresses : (nic.IPAddresses ? nic.IPAddresses.split(',') : []);
        const ipv4 = ips.map(ip => String(ip || '').trim()).find(ip =>
          /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip) && !ip.startsWith('169.254') && ip !== '127.0.0.1'
        );
        if (ipv4) { autoIP = ipv4; break; }
      }
    }

    const override = await db.get(
      'SELECT rdp_port, rdp_host, rdp_username, rdp_password, use_manual, updated_at FROM vm_console_overrides WHERE vm_name = ?',
      [req.params.name]
    );

    if (!override) {
      return res.json({ vm_name: req.params.name, auto_ip: autoIP, default_rdp_port: defaultPort, rdp_port: defaultPort, rdp_host: '', rdp_username: '', rdp_password: '', use_manual: false, updated_at: null });
    }

    return res.json({
      vm_name: req.params.name,
      auto_ip: autoIP,
      default_rdp_port: defaultPort,
      rdp_port: String(override.rdp_port || defaultPort),
      rdp_host: override.rdp_host || '',
      rdp_username: override.rdp_username || '',
      rdp_password: override.rdp_password ? '[ENCRYPTED]' : '',
      use_manual: override.use_manual === 1,
      updated_at: override.updated_at,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /vms/:name/console-config
router.put('/:name/console-config', requireAdmin, async (req, res) => {
  try {
    const { rdp_port, rdp_host, rdp_username, rdp_password, use_manual } = req.body || {};

    let port = 3389;
    if (rdp_port !== undefined && rdp_port !== null && String(rdp_port).trim() !== '') {
      port = parseInt(rdp_port, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        return res.status(400).json({ error: 'rdp_port must be a valid TCP port (1-65535)' });
      }
    }

    const shouldClear = !rdp_host && !rdp_username && (!rdp_password || rdp_password === '[ENCRYPTED]') &&
                        (rdp_port === undefined || rdp_port === null || String(rdp_port).trim() === '');

    if (shouldClear) {
      await db.run('DELETE FROM vm_console_overrides WHERE vm_name = ?', [req.params.name]);
      return res.json({ success: true, cleared: true });
    }

    const useManualValue = use_manual === true ? 1 : 0;
    const hostValue = rdp_host || '';
    const usernameValue = rdp_username || '';
    const passwordValue = (rdp_password && rdp_password !== '[ENCRYPTED]') ? rdp_password : null;

    if (passwordValue) {
      await db.run(
        `INSERT INTO vm_console_overrides (vm_name, rdp_port, rdp_host, rdp_username, rdp_password, use_manual, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE rdp_port=VALUES(rdp_port), rdp_host=VALUES(rdp_host), rdp_username=VALUES(rdp_username),
           rdp_password=VALUES(rdp_password), use_manual=VALUES(use_manual), updated_by=VALUES(updated_by)`,
        [req.params.name, port, hostValue, usernameValue, passwordValue, useManualValue, req.user.id]
      );
    } else {
      await db.run(
        `INSERT INTO vm_console_overrides (vm_name, rdp_port, rdp_host, rdp_username, use_manual, updated_by)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE rdp_port=VALUES(rdp_port), rdp_host=VALUES(rdp_host), rdp_username=VALUES(rdp_username),
           use_manual=VALUES(use_manual), updated_by=VALUES(updated_by)`,
        [req.params.name, port, hostValue, usernameValue, useManualValue, req.user.id]
      );
    }

    res.json({ success: true, rdp_port: String(port), rdp_host: hostValue, rdp_username: usernameValue, use_manual: useManualValue === 1, cleared: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
