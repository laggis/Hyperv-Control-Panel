const express = require('express');
const router  = express.Router();
const ps      = require('../utils/powershell');
const db      = require('../utils/database');
const { authMiddleware, requireAdmin } = require('../middleware/auth');
const { auditLog } = require('../middleware/audit');

router.use(authMiddleware, requireAdmin);

router.get('/', async (req, res) => {
  try {
    const row    = await db.get("SELECT value FROM settings WHERE `key` = 'iso_folder'");
    const folder = row?.value || 'C:\\ISO';
    const isos   = await ps.listISOs(folder);
    res.json({ folder, isos });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/attach', auditLog({ action: 'ISO_ATTACH' }), async (req, res) => {
  const { vmName, isoPath } = req.body;
  if (!vmName || !isoPath) return res.status(400).json({ error: 'vmName and isoPath required' });
  try { await ps.attachISO(vmName, isoPath); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/detach', auditLog({ action: 'ISO_DETACH' }), async (req, res) => {
  const { vmName } = req.body;
  if (!vmName) return res.status(400).json({ error: 'vmName required' });
  try { await ps.detachISO(vmName); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/vm/:name', async (req, res) => {
  try { res.json(await ps.getVMDvdDrive(req.params.name)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/folder', async (req, res) => {
  const { folder } = req.body;
  if (!folder) return res.status(400).json({ error: 'folder required' });
  await db.run("INSERT INTO settings (`key`, value) VALUES ('iso_folder', ?) ON DUPLICATE KEY UPDATE value = ?", [folder, folder]);
  res.json({ success: true, folder });
});

module.exports = router;
