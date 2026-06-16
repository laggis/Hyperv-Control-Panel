const mysql  = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const pool = mysql.createPool({
  host:               process.env.DB_HOST     || 'localhost',
  port:               parseInt(process.env.DB_PORT || '3306'),
  user:               process.env.DB_USER     || 'hyperv_panel',
  password:           process.env.DB_PASSWORD || '',
  database:           process.env.DB_NAME     || 'hyperv_panel',
  waitForConnections: true,
  connectionLimit:    10,
  queueLimit:         0,
  timezone:           'Z',
  decimalNumbers:     true,
});

async function all(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function get(sql, params = []) {
  const rows = await all(sql, params);
  return rows[0];
}

async function run(sql, params = []) {
  const [result] = await pool.execute(sql, params);
  return { insertId: result.insertId, affectedRows: result.affectedRows };
}

async function exec(sql) {
  const conn = await pool.getConnection();
  try {
    const statements = sql.split(';').map(s => s.trim()).filter(Boolean);
    for (const stmt of statements) {
      await conn.query(stmt);
    }
  } finally {
    conn.release();
  }
}

async function initSchema() {
  const tables = [
    `CREATE TABLE IF NOT EXISTS users (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      username      VARCHAR(100) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      discord_id    VARCHAR(40) UNIQUE NULL,
      role          VARCHAR(20) NOT NULL DEFAULT 'user',
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login    DATETIME NULL
    )`,
    `CREATE TABLE IF NOT EXISTS audit_logs (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      user_id    INT NULL,
      username   VARCHAR(100),
      action     VARCHAR(100) NOT NULL,
      vm_name    VARCHAR(200),
      details    TEXT,
      status     VARCHAR(20) NOT NULL DEFAULT 'success',
      ip_address VARCHAR(100),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    )`,
    `CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      vm_name         VARCHAR(200) NOT NULL,
      action          VARCHAR(100) NOT NULL,
      cron_expression VARCHAR(100) NOT NULL,
      enabled         TINYINT(1) DEFAULT 1,
      last_run        DATETIME NULL,
      next_run        DATETIME NULL,
      created_by      INT NULL,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    )`,
    `CREATE TABLE IF NOT EXISTS clients (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      name           VARCHAR(200) NOT NULL,
      contact_name   VARCHAR(200),
      email          VARCHAR(200),
      phone          VARCHAR(50),
      notes          TEXT,
      billing_plan   VARCHAR(100),
      billing_amount DECIMAL(10,2),
      billing_cycle  VARCHAR(20) DEFAULT 'monthly',
      color          VARCHAR(20) DEFAULT '#3b82f6',
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS vm_client_assignments (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      vm_name     VARCHAR(200) NOT NULL,
      client_id   INT NOT NULL,
      assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      assigned_by INT NULL,
      UNIQUE KEY uq_vm (vm_name),
      FOREIGN KEY (client_id)   REFERENCES clients(id) ON DELETE CASCADE,
      FOREIGN KEY (assigned_by) REFERENCES users(id)   ON DELETE SET NULL
    )`,
    `CREATE TABLE IF NOT EXISTS user_vm_access (
      id      INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      vm_name VARCHAR(200) NOT NULL,
      UNIQUE KEY uq_user_vm (user_id, vm_name),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS vm_roots (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      path       VARCHAR(500) NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_path (path(255))
    )`,
    `CREATE TABLE IF NOT EXISTS vm_console_overrides (
      vm_name      VARCHAR(200) PRIMARY KEY,
      rdp_port     INT DEFAULT 3389,
      rdp_host     VARCHAR(100),
      rdp_username VARCHAR(100),
      rdp_password VARCHAR(255),
      use_manual   TINYINT(1) DEFAULT 0,
      updated_by   INT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
    )`,
    "CREATE TABLE IF NOT EXISTS settings (`key` VARCHAR(100) PRIMARY KEY, value TEXT NOT NULL, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)",
    `CREATE TABLE IF NOT EXISTS sessions (
      id            VARCHAR(36) PRIMARY KEY,
      user_id       INT NOT NULL,
      refresh_token VARCHAR(100) UNIQUE NOT NULL,
      ip_address    VARCHAR(100),
      user_agent    TEXT,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_active   DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      expires_at    DATETIME NOT NULL,
      revoked       TINYINT(1) DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS login_attempts (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      username   VARCHAR(100) NOT NULL,
      ip_address VARCHAR(100) NOT NULL,
      success    TINYINT(1) DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS totp_secrets (
      user_id    INT PRIMARY KEY,
      secret     VARCHAR(100) NOT NULL,
      verified   TINYINT(1) DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS bandwidth_history (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      vm_name     VARCHAR(200) NOT NULL,
      bytes_in    BIGINT DEFAULT 0,
      bytes_out   BIGINT DEFAULT 0,
      recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_bw_vm_time (vm_name, recorded_at)
    )`,
    `CREATE TABLE IF NOT EXISTS alert_rules (
      id               INT AUTO_INCREMENT PRIMARY KEY,
      vm_name          VARCHAR(200),
      metric           VARCHAR(50) NOT NULL,
      operator         VARCHAR(10) NOT NULL,
      threshold        DECIMAL(10,2) NOT NULL,
      enabled          TINYINT(1) DEFAULT 1,
      notify_email     VARCHAR(200),
      notify_webhook   VARCHAR(500),
      cooldown_minutes INT DEFAULT 30,
      last_triggered   DATETIME NULL,
      created_by       INT NULL,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    )`,
    `CREATE TABLE IF NOT EXISTS alert_events (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      rule_id    INT NOT NULL,
      vm_name    VARCHAR(200) NOT NULL,
      metric     VARCHAR(50) NOT NULL,
      value      DECIMAL(10,2),
      message    TEXT,
      notified   TINYINT(1) DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (rule_id) REFERENCES alert_rules(id) ON DELETE CASCADE
    )`,

    `CREATE TABLE IF NOT EXISTS client_notes (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      client_id  INT NOT NULL,
      user_id    INT NULL,
      username   VARCHAR(100),
      type       VARCHAR(30) DEFAULT 'note',
      subject    VARCHAR(200),
      body       TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id)   REFERENCES users(id)   ON DELETE SET NULL
    )`,

    `CREATE TABLE IF NOT EXISTS vm_uptime_log (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      vm_name     VARCHAR(200) NOT NULL,
      state       VARCHAR(30)  NOT NULL,
      recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_uptime_vm_time (vm_name, recorded_at)
    )`,
    `CREATE TABLE IF NOT EXISTS vm_cache (
      name                   VARCHAR(200) PRIMARY KEY,
      state                  VARCHAR(30),
      cpu_usage              DECIMAL(6,2) DEFAULT 0,
      memory_assigned_gb     DECIMAL(10,2) DEFAULT 0,
      memory_demand_gb       DECIMAL(10,2) DEFAULT 0,
      uptime_json            TEXT,
      status                 VARCHAR(50),
      version                VARCHAR(20),
      generation             INT,
      processor_count        INT,
      path                   VARCHAR(500),
      configuration_location VARCHAR(500),
      vhd_paths_json         TEXT,
      synced_at              DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_vm_cache_state (state),
      INDEX idx_vm_cache_synced (synced_at)
    )`,
    `CREATE TABLE IF NOT EXISTS discord_whitelist (
      discord_id  VARCHAR(40) PRIMARY KEY,
      note        VARCHAR(255) NULL,
      created_by  INT NULL,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    )`,
    `CREATE TABLE IF NOT EXISTS login_risk_events (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      user_id        INT NOT NULL,
      ip_address     VARCHAR(100) NOT NULL,
      country_code   VARCHAR(10) NULL,
      asn            VARCHAR(100) NULL,
      risk_level     VARCHAR(20) NOT NULL DEFAULT 'low',
      reason         VARCHAR(255) NOT NULL,
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_risk_user_time (user_id, created_at),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS ddos_events (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      vm_name        VARCHAR(200) NOT NULL,
      detection_type VARCHAR(50) NOT NULL,
      severity       VARCHAR(20) NOT NULL DEFAULT 'medium',
      metrics        JSON NULL,
      action_taken   VARCHAR(50) DEFAULT 'none',
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_ddos_vm_time (vm_name, created_at)
    )`,
  ];

  for (const ddl of tables) {
    await exec(ddl);
  }

  // Add Phase 3 columns to existing tables if they don't exist yet
  const alterStatements = [
    "ALTER TABLE clients ADD COLUMN IF NOT EXISTS renewal_date DATE NULL",
    "ALTER TABLE clients ADD COLUMN IF NOT EXISTS renewal_amount DECIMAL(10,2) NULL",
    "ALTER TABLE clients ADD COLUMN IF NOT EXISTS renewal_notes VARCHAR(500) NULL",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS discord_id VARCHAR(40) UNIQUE NULL",
  ];
  for (const stmt of alterStatements) {
    try { await exec(stmt); } catch { /* column already exists — safe to ignore */ }
  }
}

async function upsertSetting(key, value) {
  await run(
    'INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE `key` = `key`',
    [key, value]
  );
}

async function seedDefaults() {
  await upsertSetting('show_all_vms',     '0');
  await upsertSetting('iso_folder',       'C:\\ISO');
  await upsertSetting('alert_email_from', '');
  await upsertSetting('alert_smtp_host',  '');
  await upsertSetting('alert_smtp_port',  '587');
  await upsertSetting('alert_smtp_user',  '');
  await upsertSetting('alert_smtp_pass',  '');
  await upsertSetting('brand_name',       'Hyper-V Panel');
  await upsertSetting('brand_color',      '#3b82f6');
  await upsertSetting('brand_logo_url',   '');
  await upsertSetting('console_url_template', '');
  await upsertSetting('console_rdp_port', '3389');
  await upsertSetting('discord_whitelist_enabled', '0');
  await upsertSetting('vm_cache_interval_sec', '30');
  await upsertSetting('ddos_alert_email', '');
  await upsertSetting('ddos_alert_webhook', '');
  await upsertSetting('ddos_detection_enabled', '1');
  await upsertSetting('ddos_auto_suspend', '0');
  await upsertSetting('ddos_auto_disconnect', '0');
  await upsertSetting('ddos_outbound_threshold_mbps', '50');
  await upsertSetting('ddos_sustained_threshold_mbps', '30');

  const row = await get('SELECT COUNT(*) AS c FROM users');
  if (!row || row.c === 0) {
    const adminUser = process.env.DEFAULT_ADMIN_USER || 'admin';

    // Generate a cryptographically random password — never stored in plaintext anywhere.
    // Printed once to stdout at first boot. Copy it immediately; it won't be shown again.
    const crypto    = require('crypto');
    const adminPass = crypto.randomBytes(18).toString('base64url'); // 24 URL-safe chars

    const hash = await bcrypt.hash(adminPass, 12);
    await run("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')", [adminUser, hash]);

    // Print prominently so it's impossible to miss in the boot log
    console.log('\n' + '='.repeat(60));
    console.log('  FIRST RUN — ADMIN ACCOUNT CREATED');
    console.log('='.repeat(60));
    console.log(`  Username : ${adminUser}`);
    console.log(`  Password : ${adminPass}`);
    console.log('  Change this password immediately after logging in.');
    console.log('='.repeat(60) + '\n');
  }
}

async function init() {
  try {
    await initSchema();
    await seedDefaults();
    console.log('✓ MySQL connected and schema ready');
  } catch (err) {
    console.error('✗ Database init failed:', err.message);
    process.exit(1);
  }
}

module.exports = { pool, all, get, run, exec, init };
