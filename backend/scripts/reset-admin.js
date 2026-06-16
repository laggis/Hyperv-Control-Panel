// Usage examples (run from backend/ directory):
//   node scripts/reset-admin.js --list
//   node scripts/reset-admin.js --username admin
//   node scripts/reset-admin.js --id 1 --username admin --password NewStrongPass123!
//
// Notes:
// - Connects to MySQL using DB_* env vars (see backend/utils/database.js).
// - If multiple admins exist and --id is not provided, the script will list them and exit.
// - Respects the UNIQUE(users.username) constraint.

const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list') args.list = true;
    else if (a === '--id') args.id = parseInt(argv[++i], 10);
    else if (a === '--username') args.username = argv[++i];
    else if (a === '--password') args.password = argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);

  const pool = await mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3307', 10),
    user: process.env.DB_USER || 'hyperv_panel',
    password: process.env.DB_PASSWORD || 'hyperv_panel',
    database: process.env.DB_NAME || 'hyperv_panel',
    waitForConnections: true,
    connectionLimit: 4,
  });

  const [admins] = await pool.execute('SELECT id, username, role, created_at FROM users WHERE role = ? ORDER BY id', ['admin']);

  if (args.list || (!args.username && !args.password && !args.id)) {
    if (admins.length === 0) {
      console.log('No admin users found.');
    } else {
      console.log('Admin users:');
      for (const u of admins) {
        console.log(` - id=${u.id} username=${u.username} created_at=${u.created_at}`);
      }
    }
    await pool.end();
    return;
  }

  if (!args.username && !args.password) {
    console.error('Nothing to do. Provide --username and/or --password. Use --list to see admins.');
    process.exit(1);
  }

  let targetId = args.id;
  if (!targetId) {
    if (admins.length === 0) {
      console.error('No admin user exists. Create one manually in DB or via app.');
      process.exit(2);
    }
    if (admins.length > 1) {
      console.error('Multiple admins found. Re-run with --id <adminId>. Use --list to see IDs.');
      process.exit(3);
    }
    targetId = admins[0].id;
  }

  // If username is provided, ensure it's available or belongs to the same id
  if (args.username) {
    const [rows] = await pool.execute('SELECT id FROM users WHERE username = ?', [args.username]);
    if (rows.length && rows[0].id !== targetId) {
      console.error(`Username "${args.username}" is already in use by id=${rows[0].id}. Choose another username.`);
      process.exit(4);
    }
  }

  // Build update
  const fields = [];
  const params = [];
  if (args.username) {
    fields.push('username = ?');
    params.push(args.username);
  }
  if (args.password) {
    const hash = await bcrypt.hash(args.password, 12);
    fields.push('password_hash = ?');
    params.push(hash);
  }
  params.push(targetId);

  const sql = `UPDATE users SET ${fields.join(', ')} WHERE id = ?`;
  const [result] = await pool.execute(sql, params);

  console.log(`Updated admin id=${targetId}. Affected rows: ${result.affectedRows}.`);
  if (args.username) console.log(` - New username: ${args.username}`);
  if (args.password) console.log(' - Password reset.');

  await pool.end();
}

main().catch(err => {
  console.error(err);
  process.exit(99);
});

