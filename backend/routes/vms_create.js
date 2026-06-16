const express = require('express');
const router = express.Router();
const ps = require('../utils/powershell');
const vmCache = require('../utils/vmCache');
const { authMiddleware, requireAdmin } = require('../middleware/auth');
const { auditLog } = require('../middleware/audit');

router.use(authMiddleware);

// GET /vms-mgmt/switches — list available virtual switches
router.get('/switches', requireAdmin, async (req, res) => {
  try {
    const switches = await ps.listSwitches();
    res.json(switches);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /vms-mgmt/create — create a new VM
router.post('/create', requireAdmin, auditLog({ action: 'VM_CREATE' }), async (req, res) => {
  try {
    const { name, ramMB, cpuCount, diskGB, generation, vhdPath, isoPath, switchName } = req.body;
    if (!name || !vhdPath) return res.status(400).json({ error: 'name and vhdPath are required' });
    await ps.createVM({ name, ramMB, cpuCount, diskGB, generation, vhdPath, isoPath, switchName });
    vmCache.scheduleSync();
    res.status(201).json({ success: true, vm: name });
  } catch (err) {
    if (err.message.includes('Invalid')) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// DELETE /vms-mgmt/:name — delete a VM
router.delete('/:name', requireAdmin, auditLog({ action: 'VM_DELETE' }), async (req, res) => {
  try {
    const deleteFiles = req.body?.deleteFiles === true;
    await ps.deleteVM(req.params.name, deleteFiles);
    vmCache.scheduleSync();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


module.exports = router;
