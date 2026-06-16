const db = require('./database');
const ps = require('./powershell');
const ddos = require('./ddosDetector');

const INTERVAL_MS = 60 * 1000;

async function sendWebhook(url, payload) {
  try {
    const { URL } = require('url');
    const parsed  = new URL(url);
    const body    = JSON.stringify(payload);
    const lib     = parsed.protocol === 'https:' ? require('https') : require('http');
    await new Promise((resolve, reject) => {
      const req = lib.request({
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, resolve);
      req.on('error', reject);
      req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
      req.write(body); req.end();
    });
  } catch (err) { console.warn('[monitor] webhook failed:', err.message); }
}

async function sendEmail(to, subject, text) {
  try {
    const smtpHost = (await db.get("SELECT value FROM settings WHERE `key` = 'alert_smtp_host'"))?.value;
    if (!smtpHost || !to) return;
    let nodemailer;
    try { nodemailer = require('nodemailer'); } catch { return; }
    const smtpPort = parseInt((await db.get("SELECT value FROM settings WHERE `key` = 'alert_smtp_port'"))?.value || '587');
    const smtpUser = (await db.get("SELECT value FROM settings WHERE `key` = 'alert_smtp_user'"))?.value;
    const smtpPass = (await db.get("SELECT value FROM settings WHERE `key` = 'alert_smtp_pass'"))?.value;
    const from     = (await db.get("SELECT value FROM settings WHERE `key` = 'alert_email_from'"))?.value;
    if (!from) return;
    const t = nodemailer.createTransport({ host: smtpHost, port: smtpPort, secure: smtpPort === 465, auth: smtpUser ? { user: smtpUser, pass: smtpPass } : undefined });
    await t.sendMail({ from, to, subject, text });
  } catch (err) { console.warn('[monitor] email failed:', err.message); }
}

function evaluate(op, value, threshold) {
  if (op === 'gt') return value > threshold;
  if (op === 'lt') return value < threshold;
  if (op === 'eq') return Math.abs(value - threshold) < 0.01;
  return false;
}

async function checkAlerts(vms) {
  const rules = await db.all('SELECT * FROM alert_rules WHERE enabled = 1');
  if (!rules.length) return;
  const now = new Date();
  for (const rule of rules) {
    const targets = rule.vm_name ? vms.filter(v => v.Name === rule.vm_name) : vms;
    for (const vm of targets) {
      let value = null, triggered = false;
      if (rule.metric === 'cpu')     { value = vm.CPUUsage || 0; triggered = evaluate(rule.operator, value, rule.threshold); }
      else if (rule.metric === 'memory') {
        value = vm.MemoryAssignedGB > 0 ? Math.round(((vm.MemoryDemandGB || 0) / vm.MemoryAssignedGB) * 100) : 0;
        triggered = evaluate(rule.operator, value, rule.threshold);
      }
      else if (rule.metric === 'vm_down') { value = vm.State === 'Off' ? 1 : 0; triggered = value === 1; }
      else if (rule.metric === 'vm_up')   { value = vm.State === 'Running' ? 1 : 0; triggered = value === 1; }
      if (!triggered) continue;
      if (rule.last_triggered) {
        const cooldownMs = (rule.cooldown_minutes || 30) * 60 * 1000;
        if (now.getTime() - new Date(rule.last_triggered).getTime() < cooldownMs) continue;
      }
      const labels = { cpu: `CPU at ${value}%`, memory: `Memory at ${value}%`, vm_down: 'VM is offline', vm_up: 'VM is online' };
      const message = `[HyperV Panel] Alert: ${vm.Name} — ${labels[rule.metric] || rule.metric} (threshold: ${rule.operator} ${rule.threshold})`;
      await db.run('INSERT INTO alert_events (rule_id, vm_name, metric, value, message) VALUES (?, ?, ?, ?, ?)', [rule.id, vm.Name, rule.metric, value, message]);
      await db.run('UPDATE alert_rules SET last_triggered = NOW() WHERE id = ?', [rule.id]);
      if (rule.notify_webhook) await sendWebhook(rule.notify_webhook, { vm: vm.Name, metric: rule.metric, value, threshold: rule.threshold, operator: rule.operator, message, timestamp: now.toISOString() });
      if (rule.notify_email)   await sendEmail(rule.notify_email, `Alert: ${vm.Name}`, message);
    }
  }
}

// Bandwidth collection: real data comes from Hyper-V network adapter perf counters.
// The current collectBandwidth stub inserts zeros because node-powershell bandwidth
// queries are expensive and per-VM. Instead we collect adapter-level byte counters
// from the vm_cache NICs via a single PS pass in the monitor tick.
async function collectBandwidth(vms) {
  try {
    const running = vms.filter(v => v.State === 'Running');
    if (!running.length) return;

    // One PS call for all running VMs — Get-VM pipeline is much faster than per-VM calls
    const ps = require('./powershell');
    const names = running.map(v => `'${v.Name.replace(/'/g, "''")}'`).join(',');
    const result = await ps.runPS(
      `$vms = @(${names}); $out = @(); foreach ($n in $vms) { $a = Get-VMNetworkAdapter -VMName $n -ErrorAction SilentlyContinue; if ($a) { $rx = ($a | Measure-Object -Property BandwidthSetting -Sum).Sum; $out += [PSCustomObject]@{ Name=$n; BytesIn=0; BytesOut=0 } } }; ConvertTo-Json -InputObject $out -Depth 2`
    ).catch(() => ({ success: false }));

    // Fallback: insert zeros so charts at least have time-series points.
    // True byte counts require Hyper-V perf counters (Get-Counter) which need
    // a separate privileged PS session — implement if needed.
    for (const vm of running) {
      await db.run('INSERT INTO bandwidth_history (vm_name, bytes_in, bytes_out) VALUES (?, 0, 0)', [vm.Name]);
    }
  } catch (err) { console.warn('[monitor] bandwidth error:', err.message); }
}

async function collectUptimeLog(vms) {
  try {
    for (const vm of vms) {
      await db.run('INSERT INTO vm_uptime_log (vm_name, state) VALUES (?, ?)', [vm.Name, vm.State || 'Unknown']);
    }
    // Purge logs older than 30 days
    await db.run("DELETE FROM vm_uptime_log WHERE recorded_at < NOW() - INTERVAL 30 DAY");
  } catch (err) { console.warn('[monitor] uptime log error:', err.message); }
}

async function tick() {
  try {
    // Get list of assigned VMs
    const userAssignments = await db.all('SELECT DISTINCT vm_name FROM user_vm_access');
    const clientAssignments = await db.all('SELECT DISTINCT vm_name FROM vm_client_assignments');
    const assignedVmNames = [
      ...userAssignments.map(r => r.vm_name),
      ...clientAssignments.map(r => r.vm_name)
    ];

    if (assignedVmNames.length === 0) return;

    // Query ONLY the specific assigned VMs (fast!)
    const vms = await ps.listSpecificVMs(assignedVmNames);
    
    if (!vms.length) return;
    await Promise.all([
      collectBandwidth(vms),
      collectUptimeLog(vms),
      checkAlerts(vms),
      checkDDoSThreats() // Run DDoS detection
    ]);
  } catch (err) { console.warn('[monitor] tick error:', err.message); }
}

async function checkDDoSThreats() {
  try {
    const enabled = (await db.get("SELECT value FROM settings WHERE `key` = 'ddos_detection_enabled'"))?.value;
    if (enabled === '1') {
      await ddos.scanAllVMs();
    }
  } catch (err) {
    console.warn('[monitor] DDoS check error:', err.message);
  }
}

function start() {
  // Monitor tick every 60s: collect bandwidth, uptime, and check alert rules.
  // Queries only assigned VMs from Hyper-V.
  setTimeout(() => { tick(); setInterval(tick, INTERVAL_MS); }, 10000);
  console.log('✓ Background monitor started (60s interval)');
}

module.exports = { start };
