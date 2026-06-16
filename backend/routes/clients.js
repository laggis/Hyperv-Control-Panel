const express = require('express');
const router  = express.Router();
const db      = require('../utils/database');
const { authMiddleware, requireAdmin, requireOperator } = require('../middleware/auth');

router.use(authMiddleware);

// ─── VM assignments ───────────────────────────────────────────────────────────

router.get('/assignments/all', async (req, res) => {
  try {
    res.json(await db.all(
      `SELECT a.vm_name, a.client_id, a.assigned_at, c.name AS client_name, c.color
       FROM vm_client_assignments a JOIN clients c ON c.id = a.client_id`));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/assignments/:vm_name', requireOperator, async (req, res) => {
  try { await db.run('DELETE FROM vm_client_assignments WHERE vm_name = ?', [req.params.vm_name]); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Clients CRUD ─────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    res.json(await db.all(
      `SELECT c.*, COUNT(a.vm_name) AS vm_count
       FROM clients c LEFT JOIN vm_client_assignments a ON a.client_id = c.id
       GROUP BY c.id ORDER BY c.name`));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', requireOperator, async (req, res) => {
  const { name, contact_name, email, phone, notes, billing_plan, billing_amount,
          billing_cycle, color, renewal_date, renewal_amount, renewal_notes } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Client name is required' });
  try {
    const { insertId } = await db.run(
      `INSERT INTO clients (name, contact_name, email, phone, notes, billing_plan,
        billing_amount, billing_cycle, color, renewal_date, renewal_amount, renewal_notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name.trim(), contact_name || null, email || null, phone || null,
       notes || null, billing_plan || null, billing_amount || null,
       billing_cycle || 'monthly', color || '#3b82f6',
       renewal_date || null, renewal_amount || null, renewal_notes || null]);
    res.status(201).json(await db.get('SELECT * FROM clients WHERE id = ?', [insertId]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const client = await db.get('SELECT * FROM clients WHERE id = ?', [req.params.id]);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    const vms   = await db.all('SELECT vm_name, assigned_at FROM vm_client_assignments WHERE client_id = ?', [req.params.id]);
    const notes = await db.all(
      'SELECT * FROM client_notes WHERE client_id = ? ORDER BY created_at DESC', [req.params.id]);
    res.json({ ...client, vms, notes });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', requireOperator, async (req, res) => {
  const { name, contact_name, email, phone, notes, billing_plan, billing_amount,
          billing_cycle, color, renewal_date, renewal_amount, renewal_notes } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Client name is required' });
  try {
    const c = await db.get('SELECT id FROM clients WHERE id = ?', [req.params.id]);
    if (!c) return res.status(404).json({ error: 'Client not found' });
    await db.run(
      `UPDATE clients SET name=?, contact_name=?, email=?, phone=?, notes=?, billing_plan=?,
        billing_amount=?, billing_cycle=?, color=?, renewal_date=?, renewal_amount=?, renewal_notes=?
       WHERE id=?`,
      [name.trim(), contact_name || null, email || null, phone || null,
       notes || null, billing_plan || null, billing_amount || null,
       billing_cycle || 'monthly', color || '#3b82f6',
       renewal_date || null, renewal_amount || null, renewal_notes || null,
       req.params.id]);
    res.json(await db.get('SELECT * FROM clients WHERE id = ?', [req.params.id]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', requireAdmin, async (req, res) => {
  try { await db.run('DELETE FROM clients WHERE id = ?', [req.params.id]); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── VM assignment ────────────────────────────────────────────────────────────

router.post('/:id/assign', requireOperator, async (req, res) => {
  const { vm_name } = req.body;
  if (!vm_name) return res.status(400).json({ error: 'vm_name is required' });
  const client = await db.get('SELECT id FROM clients WHERE id = ?', [req.params.id]);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  try {
    await db.run(
      `INSERT INTO vm_client_assignments (vm_name, client_id, assigned_by) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE client_id = ?, assigned_at = NOW(), assigned_by = ?`,
      [vm_name, req.params.id, req.user.id, req.params.id, req.user.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Client notes / ticket log ────────────────────────────────────────────────

// GET /clients/:id/notes
router.get('/:id/notes', async (req, res) => {
  try {
    const notes = await db.all(
      'SELECT * FROM client_notes WHERE client_id = ? ORDER BY created_at DESC',
      [req.params.id]);
    res.json(notes);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /clients/:id/notes
router.post('/:id/notes', requireOperator, async (req, res) => {
  const { type = 'note', subject, body } = req.body;
  if (!body?.trim()) return res.status(400).json({ error: 'body is required' });
  const validTypes = ['note', 'call', 'email', 'ticket', 'billing', 'other'];
  if (!validTypes.includes(type)) return res.status(400).json({ error: 'Invalid type' });
  try {
    const { insertId } = await db.run(
      'INSERT INTO client_notes (client_id, user_id, username, type, subject, body) VALUES (?, ?, ?, ?, ?, ?)',
      [req.params.id, req.user.id, req.user.username, type, subject || null, body.trim()]);
    res.status(201).json(await db.get('SELECT * FROM client_notes WHERE id = ?', [insertId]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /clients/:id/notes/:noteId
router.put('/:id/notes/:noteId', requireOperator, async (req, res) => {
  const { type, subject, body } = req.body;
  if (!body?.trim()) return res.status(400).json({ error: 'body is required' });
  try {
    const note = await db.get('SELECT * FROM client_notes WHERE id = ? AND client_id = ?', [req.params.noteId, req.params.id]);
    if (!note) return res.status(404).json({ error: 'Note not found' });
    // Only the author or admin can edit
    if (req.user.role !== 'admin' && note.user_id !== req.user.id)
      return res.status(403).json({ error: 'Not authorized' });
    await db.run('UPDATE client_notes SET type=?, subject=?, body=? WHERE id=?',
      [type || note.type, subject || null, body.trim(), req.params.noteId]);
    res.json(await db.get('SELECT * FROM client_notes WHERE id = ?', [req.params.noteId]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /clients/:id/notes/:noteId
router.delete('/:id/notes/:noteId', requireOperator, async (req, res) => {
  const note = await db.get('SELECT * FROM client_notes WHERE id = ? AND client_id = ?', [req.params.noteId, req.params.id]);
  if (!note) return res.status(404).json({ error: 'Note not found' });
  if (req.user.role !== 'admin' && note.user_id !== req.user.id)
    return res.status(403).json({ error: 'Not authorized' });
  try { await db.run('DELETE FROM client_notes WHERE id = ?', [req.params.noteId]); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── VM usage report data ─────────────────────────────────────────────────────

// GET /clients/:id/report?days=30  — uptime + resource stats for all VMs of this client
router.get('/:id/report', async (req, res) => {
  try {
    const client = await db.get('SELECT * FROM clients WHERE id = ?', [req.params.id]);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const days = Math.min(90, Math.max(1, parseInt(req.query.days) || 30));
    const vms  = await db.all('SELECT vm_name FROM vm_client_assignments WHERE client_id = ?', [req.params.id]);

    const vmReports = await Promise.all(vms.map(async ({ vm_name }) => {
      // Uptime percentage from vm_uptime_log
      const total  = await db.get(
        `SELECT COUNT(*) AS c FROM vm_uptime_log WHERE vm_name = ? AND recorded_at > NOW() - INTERVAL ${days} DAY`,
        [vm_name]);
      const running = await db.get(
        `SELECT COUNT(*) AS c FROM vm_uptime_log WHERE vm_name = ? AND state = 'Running' AND recorded_at > NOW() - INTERVAL ${days} DAY`,
        [vm_name]);

      const uptimePct = total.c > 0 ? Math.round((running.c / total.c) * 100) : null;

      // Bandwidth totals
      const bw = await db.get(
        `SELECT SUM(bytes_in) AS total_in, SUM(bytes_out) AS total_out FROM bandwidth_history
         WHERE vm_name = ? AND recorded_at > NOW() - INTERVAL ${days} DAY`,
        [vm_name]);

      return {
        vm_name,
        uptime_pct: uptimePct,
        total_in:   bw?.total_in  || 0,
        total_out:  bw?.total_out || 0,
        samples:    total.c,
      };
    }));

    res.json({
      client,
      period_days: days,
      generated_at: new Date().toISOString(),
      vms: vmReports,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Renewals coming up (used by dashboard) ───────────────────────────────────

// GET /clients/renewals?days=30  — clients with renewal_date within next N days
router.get('/renewals/upcoming', async (req, res) => {
  try {
    const days = Math.min(365, Math.max(1, parseInt(req.query.days) || 30));
    const rows = await db.all(
      `SELECT id, name, color, email, renewal_date, renewal_amount, renewal_notes,
              DATEDIFF(renewal_date, CURDATE()) AS days_until
       FROM clients
       WHERE renewal_date IS NOT NULL
         AND renewal_date >= CURDATE()
         AND renewal_date <= DATE_ADD(CURDATE(), INTERVAL ? DAY)
       ORDER BY renewal_date ASC`,
      [days]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
