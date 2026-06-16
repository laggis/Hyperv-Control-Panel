const db = require('../utils/database');

function auditLog({ action }) {
  return (req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      const status  = res.statusCode >= 400 ? 'failure' : 'success';
      const details = res.statusCode >= 400 ? JSON.stringify(body) : JSON.stringify(req.body || {});
      db.run(
        `INSERT INTO audit_logs (user_id, username, action, vm_name, details, status, ip_address)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          req.user?.id    || null,
          req.user?.username || 'anonymous',
          action,
          req.params?.name || null,
          details,
          status,
          req.ip || null,
        ]
      ).catch(() => {});
      return originalJson(body);
    };
    next();
  };
}

module.exports = { auditLog };
