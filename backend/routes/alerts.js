const express = require('express');
const router  = express.Router();
const db      = require('../utils/database');
const { authMiddleware, requireAdmin } = require('../middleware/auth');

router.use(authMiddleware, requireAdmin);

router.get('/events', async (req, res) => {
  const limit  = Math.min(200, parseInt(req.query.limit) || 50);
  const events = await db.all(
    `SELECT e.*, r.metric, r.operator, r.threshold FROM alert_events e
     JOIN alert_rules r ON r.id = e.rule_id ORDER BY e.created_at DESC LIMIT ?`, [limit]);
  res.json(events);
});

router.get('/', async (req, res) => {
  res.json(await db.all('SELECT * FROM alert_rules ORDER BY created_at DESC'));
});

router.post('/', async (req, res) => {
  const { vm_name, metric, operator, threshold, notify_email, notify_webhook, cooldown_minutes = 30 } = req.body;
  const validMetrics = ['cpu', 'memory', 'disk', 'vm_down', 'vm_up'];
  const validOps     = ['gt', 'lt', 'eq'];
  if (!metric || !operator || threshold === undefined) return res.status(400).json({ error: 'metric, operator, and threshold are required' });
  if (!validMetrics.includes(metric))  return res.status(400).json({ error: 'Invalid metric' });
  if (!validOps.includes(operator))    return res.status(400).json({ error: 'Invalid operator' });
  try {
    const { insertId } = await db.run(
      'INSERT INTO alert_rules (vm_name, metric, operator, threshold, notify_email, notify_webhook, cooldown_minutes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [vm_name || null, metric, operator, parseFloat(threshold), notify_email || null, notify_webhook || null, cooldown_minutes, req.user.id]);
    res.status(201).json({ id: insertId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  const { enabled, notify_email, notify_webhook, threshold, cooldown_minutes } = req.body;
  const parts = [], vals = [];
  if (enabled          !== undefined) { parts.push('enabled = ?');          vals.push(enabled ? 1 : 0); }
  if (notify_email     !== undefined) { parts.push('notify_email = ?');     vals.push(notify_email); }
  if (notify_webhook   !== undefined) { parts.push('notify_webhook = ?');   vals.push(notify_webhook); }
  if (threshold        !== undefined) { parts.push('threshold = ?');        vals.push(parseFloat(threshold)); }
  if (cooldown_minutes !== undefined) { parts.push('cooldown_minutes = ?'); vals.push(cooldown_minutes); }
  if (!parts.length) return res.status(400).json({ error: 'Nothing to update' });
  vals.push(parseInt(req.params.id));
  try {
    await db.run(`UPDATE alert_rules SET ${parts.join(', ')} WHERE id = ?`, vals);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  await db.run('DELETE FROM alert_rules WHERE id = ?', [parseInt(req.params.id)]);
  res.json({ success: true });
});

module.exports = router;
