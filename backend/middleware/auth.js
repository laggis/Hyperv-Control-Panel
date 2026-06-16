const jwt = require('jsonwebtoken');
const db  = require('../utils/database');

async function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret');
    const user = await db.get('SELECT id, username, role, discord_id FROM users WHERE id = ?', [payload.userId]);
    if (!user) return res.status(401).json({ error: 'User no longer exists' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

async function requireOperator(req, res, next) {
  const role = req.user?.role;
  if (role === 'admin') return next();
  if (['user', 'operator', 'viewer'].includes(role)) {
    try {
      const vmName = req.params?.name;
      if (!vmName) return res.status(400).json({ error: 'VM name required' });
      const row = await db.get('SELECT 1 AS ok FROM user_vm_access WHERE user_id = ? AND vm_name = ?', [req.user.id, vmName]);
      if (!row) return res.status(403).json({ error: 'Access denied for this VM' });
      return next();
    } catch {
      return res.status(500).json({ error: 'Permission check failed' });
    }
  }
  return res.status(403).json({ error: 'Access required' });
}

const requireOperatorOrAssignedViewer = requireOperator;

module.exports = { authMiddleware, requireAdmin, requireOperator, requireOperatorOrAssignedViewer };
