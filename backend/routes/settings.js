const express = require('express');
const router  = express.Router();
const { authMiddleware, requireAdmin } = require('../middleware/auth');
const db = require('../utils/database');

router.use(authMiddleware, requireAdmin);

async function upsert(key, value) {
  await db.run('INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)', [key, value]);
}

router.get('/', async (req, res) => {
  try {
  const rows = await db.all('SELECT `key`, value FROM settings');
  const obj  = Object.fromEntries(rows.map(r => [r.key, r.value]));
  res.json({
    show_all_vms:     obj.show_all_vms === '1',
    iso_folder:       obj.iso_folder        || 'C:\\ISO',
    alert_email_from: obj.alert_email_from  || '',
    alert_smtp_host:  obj.alert_smtp_host   || '',
    alert_smtp_port:  obj.alert_smtp_port   || '587',
    alert_smtp_user:  obj.alert_smtp_user   || '',
    alert_smtp_pass:  obj.alert_smtp_pass   || '',
    brand_name:       obj.brand_name        || 'Hyper-V Panel',
    brand_color:      obj.brand_color       || '#3b82f6',
    brand_logo_url:   obj.brand_logo_url    || '',
    console_url_template: obj.console_url_template || '',
    console_rdp_port: obj.console_rdp_port || '3389',
    discord_whitelist_enabled: obj.discord_whitelist_enabled === '1',
  });
  } catch (err) {
    console.error('[settings GET]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.put('/show_all_vms', async (req, res) => {
  const val = req.body?.value === true || req.body?.value === '1';
  await upsert('show_all_vms', val ? '1' : '0');
  res.json({ success: true, show_all_vms: val });
});

router.put('/iso_folder', async (req, res) => {
  const { value } = req.body;
  if (!value) return res.status(400).json({ error: 'value required' });
  await upsert('iso_folder', value);
  res.json({ success: true });
});

router.put('/smtp', async (req, res) => {
  const { host, port, user, pass, from } = req.body;
  if (host !== undefined) await upsert('alert_smtp_host',  host);
  if (port !== undefined) await upsert('alert_smtp_port',  String(port));
  if (user !== undefined) await upsert('alert_smtp_user',  user);
  if (pass !== undefined) await upsert('alert_smtp_pass',  pass);
  if (from !== undefined) await upsert('alert_email_from', from);
  res.json({ success: true });
});

router.put('/branding', async (req, res) => {
  const { brand_name, brand_color, brand_logo_url } = req.body;
  if (brand_name      !== undefined) await upsert('brand_name',      brand_name);
  if (brand_color     !== undefined) await upsert('brand_color',     brand_color);
  if (brand_logo_url  !== undefined) await upsert('brand_logo_url',  brand_logo_url);
  res.json({ success: true });
});


router.put('/console', async (req, res) => {
  const template = String(req.body?.url_template || '').trim();
  const rdpPortRaw = req.body?.rdp_port;
  const rdpPort = parseInt(rdpPortRaw, 10);

  if (!template) {
    await upsert('console_url_template', '');
  } else {
    if (!/^https?:\/\//i.test(template)) {
      return res.status(400).json({ error: 'url_template must start with http:// or https://' });
    }
    if (!template.includes('{host}')) {
      return res.status(400).json({ error: 'url_template must include {host}' });
    }
    await upsert('console_url_template', template);
  }

  if (rdpPortRaw !== undefined && rdpPortRaw !== null && String(rdpPortRaw).trim() !== '') {
    if (isNaN(rdpPort) || rdpPort < 1 || rdpPort > 65535) {
      return res.status(400).json({ error: 'rdp_port must be a valid TCP port (1-65535)' });
    }
    await upsert('console_rdp_port', String(rdpPort));
  }

  res.json({ success: true });
});

router.put('/discord-whitelist', async (req, res) => {
  const enabled = req.body?.enabled === true || req.body?.enabled === '1';
  await upsert('discord_whitelist_enabled', enabled ? '1' : '0');
  res.json({ success: true, enabled });
});

module.exports = router;
