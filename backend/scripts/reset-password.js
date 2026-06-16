// Usage:
//   node scripts/reset-password.js <username> <newPassword>
//
// Notes:
// - Works even if you cannot log in to the panel.
// - Connects to MySQL using DB_* env vars (requires dotenv or pre-set env).
// - Does not create users; it only updates an existing user's password.

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql  = require('mysql2/promise');
const bcrypt = require('bcryptjs');

async function main() {
  const [, , username, newPassword] = process.argv;
  if (!username || !newPassword) {
    console.error('Usage: node scripts/reset-password.js <username> <newPassword>');
    process.exit(1);
  }

  const pool = await mysql.createPool({
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT || '3307', 10),
    user:     process.env.DB_USER     || 'hyperv_panel',
    password: process.env.DB_PASSWORD || 'hyperv_panel',
    database: process.env.DB_NAME     || 'hyperv_panel',
    waitForConnections: true,
    connectionLimit: 2,
  });

  const [rows] = await pool.execute('SELECT id, username FROM users WHERE username = ?', [username]);
  if (!rows.length) {
    console.error(`User "${username}" not found.`);
    await pool.end();
    process.exit(2);
  }

  const user = rows[0];
  const hash = await bcrypt.hash(newPassword, 12);
  await pool.execute('UPDATE users SET password_hash = ? WHERE id = ?', [hash, user.id]);
  // Invalidate all existing sessions so the new password takes effect immediately
  await pool.execute('UPDATE sessions SET revoked = 1 WHERE user_id = ?', [user.id]);
  console.log(`Password updated for user "${username}". All existing sessions revoked.`);

  await pool.end();
}

main().catch(err => {
  console.error(err);
  process.exit(99);
});
