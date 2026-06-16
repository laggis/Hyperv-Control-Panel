const express = require('express');
const router = express.Router();
const db = require('../utils/database');
const ddos = require('../utils/ddosDetector');
const { authMiddleware, requireAdmin } = require('../middleware/auth');

router.use(authMiddleware);

// Get DDoS events (admin only)
router.get('/events', requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const vmName = req.query.vm_name;
    
    let query = 'SELECT * FROM ddos_events';
    let params = [];
    
    if (vmName) {
      query += ' WHERE vm_name = ?';
      params.push(vmName);
    }
    
    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);
    
    const events = await db.all(query, params);
    
    // Parse JSON metrics
    const parsed = events.map(e => ({
      ...e,
      metrics: e.metrics ? JSON.parse(e.metrics) : null,
    }));
    
    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get DDoS statistics (admin only)
router.get('/stats', requireAdmin, async (req, res) => {
  try {
    const last24h = await db.get(
      `SELECT COUNT(*) as count FROM ddos_events 
       WHERE created_at > NOW() - INTERVAL 24 HOUR`
    );
    
    const last7d = await db.get(
      `SELECT COUNT(*) as count FROM ddos_events 
       WHERE created_at > NOW() - INTERVAL 7 DAY`
    );
    
    const byType = await db.all(
      `SELECT detection_type, COUNT(*) as count 
       FROM ddos_events 
       WHERE created_at > NOW() - INTERVAL 7 DAY
       GROUP BY detection_type`
    );
    
    const bySeverity = await db.all(
      `SELECT severity, COUNT(*) as count 
       FROM ddos_events 
       WHERE created_at > NOW() - INTERVAL 7 DAY
       GROUP BY severity`
    );
    
    const topVMs = await db.all(
      `SELECT vm_name, COUNT(*) as count 
       FROM ddos_events 
       WHERE created_at > NOW() - INTERVAL 7 DAY
       GROUP BY vm_name 
       ORDER BY count DESC 
       LIMIT 10`
    );
    
    res.json({
      last_24h: last24h.count,
      last_7d: last7d.count,
      by_type: byType,
      by_severity: bySeverity,
      top_vms: topVMs,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get DDoS configuration (admin only)
router.get('/config', requireAdmin, async (req, res) => {
  try {
    const settings = await db.all(
      "SELECT `key`, value FROM settings WHERE `key` LIKE 'ddos_%'"
    );
    
    const config = {};
    settings.forEach(s => {
      config[s.key] = s.value;
    });
    
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update DDoS configuration (admin only)
router.put('/config', requireAdmin, async (req, res) => {
  try {
    const allowed = [
      'ddos_detection_enabled',
      'ddos_auto_suspend',
      'ddos_auto_disconnect',
      'ddos_outbound_threshold_mbps',
      'ddos_sustained_threshold_mbps',
      'ddos_alert_email',
      'ddos_alert_webhook',
    ];
    
    for (const key of Object.keys(req.body)) {
      if (!allowed.includes(key)) {
        return res.status(400).json({ error: `Invalid setting: ${key}` });
      }
      
      await db.run(
        "INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = ?",
        [key, String(req.body[key]), String(req.body[key])]
      );
    }
    
    // Update in-memory config
    const newConfig = {};
    if ('ddos_auto_suspend' in req.body) {
      newConfig.AUTO_SUSPEND_ENABLED = req.body.ddos_auto_suspend === '1';
    }
    if ('ddos_auto_disconnect' in req.body) {
      newConfig.AUTO_DISCONNECT_NETWORK = req.body.ddos_auto_disconnect === '1';
    }
    if ('ddos_outbound_threshold_mbps' in req.body) {
      newConfig.OUTBOUND_SPIKE_THRESHOLD = parseFloat(req.body.ddos_outbound_threshold_mbps);
    }
    if ('ddos_sustained_threshold_mbps' in req.body) {
      newConfig.OUTBOUND_SUSTAINED_THRESHOLD = parseFloat(req.body.ddos_sustained_threshold_mbps);
    }
    
    ddos.updateConfig(newConfig);
    
    await db.run(
      `INSERT INTO audit_logs (user_id, username, action, details, status)
       VALUES (?, ?, 'update_ddos_config', ?, 'success')`,
      [req.user.id, req.user.username, JSON.stringify(req.body)]
    );
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manual DDoS scan for a VM (admin only)
router.post('/scan/:vmName', requireAdmin, async (req, res) => {
  try {
    const vmName = req.params.vmName;
    
    const detection = await ddos.detectDDoS(vmName, null);
    
    await db.run(
      `INSERT INTO audit_logs (user_id, username, action, vm_name, details, status)
       VALUES (?, ?, 'ddos_manual_scan', ?, ?, 'success')`,
      [req.user.id, req.user.username, vmName, JSON.stringify(detection)]
    );
    
    res.json(detection);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manual action: disconnect network (admin only)
router.post('/disconnect/:vmName', requireAdmin, async (req, res) => {
  try {
    const vmName = req.params.vmName;
    
    const success = await ddos.disconnectVMNetwork(vmName);
    
    await db.run(
      `INSERT INTO audit_logs (user_id, username, action, vm_name, details, status)
       VALUES (?, ?, 'ddos_manual_disconnect', ?, 'Manual network disconnect', ?)`,
      [req.user.id, req.user.username, vmName, success ? 'success' : 'failed']
    );
    
    res.json({ success });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manual action: suspend VM (admin only)
router.post('/suspend/:vmName', requireAdmin, async (req, res) => {
  try {
    const vmName = req.params.vmName;
    
    const success = await ddos.suspendVM(vmName);
    
    await db.run(
      `INSERT INTO audit_logs (user_id, username, action, vm_name, details, status)
       VALUES (?, ?, 'ddos_manual_suspend', ?, 'Manual VM suspension', ?)`,
      [req.user.id, req.user.username, vmName, success ? 'success' : 'failed']
    );
    
    res.json({ success });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Clear old DDoS events (admin only)
router.delete('/events/cleanup', requireAdmin, async (req, res) => {
  try {
    const days = Math.min(90, Math.max(1, parseInt(req.query.days) || 30));
    
    const result = await db.run(
      `DELETE FROM ddos_events WHERE created_at < NOW() - INTERVAL ${days} DAY`
    );
    
    res.json({ deleted: result.affectedRows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
