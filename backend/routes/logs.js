const express = require('express');
const router  = express.Router();
const db      = require('../utils/database');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

router.get('/', async (req, res) => {
  const page   = Math.max(1, parseInt(req.query.page)  || 1);
  const limit  = Math.min(100, parseInt(req.query.limit) || 50);
  const offset = (page - 1) * limit;
  const vmFilter     = req.query.vm     || null;
  const actionFilter = req.query.action || null;

  let where  = req.user.role === 'admin' ? 'WHERE 1=1' : 'WHERE user_id = ?';
  const params = req.user.role === 'admin' ? [] : [req.user.id];

  if (vmFilter)     { where += ' AND vm_name = ?';  params.push(vmFilter); }
  if (actionFilter) { where += ' AND action = ?';   params.push(actionFilter); }

  const logs  = await db.all(`SELECT * FROM audit_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
  const count = await db.get(`SELECT COUNT(*) AS c FROM audit_logs ${where}`, params);

  res.json({ logs, pagination: { page, limit, total: count.c, pages: Math.ceil(count.c / limit) } });
});

module.exports = router;
