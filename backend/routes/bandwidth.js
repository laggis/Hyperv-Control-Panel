const express = require('express');
const router  = express.Router();
const db      = require('../utils/database');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

router.get('/:vmName', async (req, res) => {
  try {
    const vmName = req.params.vmName;

    // Enforce VM-level access for user/viewer roles
    if (req.user.role === 'user' || req.user.role === 'viewer') {
      const access = await db.get(
        'SELECT 1 AS ok FROM user_vm_access WHERE user_id = ? AND vm_name = ?',
        [req.user.id, vmName]
      );
      if (!access) return res.status(403).json({ error: 'Access denied for this VM' });
    }

    const hours = Math.min(168, Math.max(1, parseInt(req.query.hours) || 24));
    const rows  = await db.all(
      `SELECT bytes_in, bytes_out, recorded_at FROM bandwidth_history
       WHERE vm_name = ? AND recorded_at > NOW() - INTERVAL ${hours} HOUR ORDER BY recorded_at ASC`,
      [vmName]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
