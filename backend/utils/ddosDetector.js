const db = require('./database');
const ps = require('./powershell');

// DDoS Detection Configuration (can be moved to database settings later)
const CONFIG = {
  // Bandwidth thresholds (MB/s)
  OUTBOUND_SPIKE_THRESHOLD: 50,      // Alert if outbound > 50 MB/s
  OUTBOUND_SUSTAINED_THRESHOLD: 30,  // Alert if avg > 30 MB/s for 5 minutes
  
  // Packet rate thresholds (packets per second)
  PPS_THRESHOLD: 100000,             // Alert if > 100k packets/sec
  
  // Connection thresholds
  OUTBOUND_CONNECTIONS_THRESHOLD: 1000, // Alert if > 1000 concurrent connections
  
  // Time windows
  SPIKE_WINDOW_MINUTES: 5,
  BASELINE_WINDOW_HOURS: 1,
  
  // Actions
  AUTO_SUSPEND_ENABLED: false,       // Auto-suspend VM on detection
  AUTO_DISCONNECT_NETWORK: false,    // Auto-disconnect network adapter
  ALERT_ONLY: true,                  // Just send alerts, no automated action
  
  // Cooldown (prevent spam)
  ALERT_COOLDOWN_MINUTES: 15,
};

/**
 * Calculate bandwidth rate from byte difference
 * @param {number} bytesDiff - Bytes transferred in interval
 * @param {number} intervalSeconds - Time interval in seconds
 * @returns {number} MB/s
 */
function calculateRate(bytesDiff, intervalSeconds) {
  if (intervalSeconds <= 0) return 0;
  const bytesPerSecond = bytesDiff / intervalSeconds;
  return bytesPerSecond / (1024 * 1024); // Convert to MB/s
}

/**
 * Get recent bandwidth history for a VM
 */
async function getRecentBandwidth(vmName, minutes) {
  const rows = await db.all(
    `SELECT bytes_in, bytes_out, recorded_at 
     FROM bandwidth_history 
     WHERE vm_name = ? AND recorded_at > NOW() - INTERVAL ${minutes} MINUTE
     ORDER BY recorded_at DESC`,
    [vmName]
  );
  return rows;
}

/**
 * Calculate baseline bandwidth for comparison
 */
async function getBaselineBandwidth(vmName, hours) {
  const result = await db.get(
    `SELECT 
       AVG(bytes_out) as avg_bytes_out,
       MAX(bytes_out) as max_bytes_out,
       COUNT(*) as sample_count
     FROM bandwidth_history 
     WHERE vm_name = ? AND recorded_at > NOW() - INTERVAL ${hours} HOUR`,
    [vmName]
  );
  return result || { avg_bytes_out: 0, max_bytes_out: 0, sample_count: 0 };
}

/**
 * Get VM network adapter statistics via PowerShell
 */
async function getVMNetworkStats(vmName) {
  try {
    const script = `
      $vm = Get-VM -Name '${vmName.replace(/'/g, "''")}' -ErrorAction Stop
      $adapters = Get-VMNetworkAdapter -VM $vm -ErrorAction SilentlyContinue
      
      $result = @{
        State = $vm.State
        Adapters = @()
      }
      
      foreach ($adapter in $adapters) {
        $result.Adapters += @{
          Name = $adapter.Name
          Connected = $adapter.Connected
          MacAddress = $adapter.MacAddress
          SwitchName = $adapter.SwitchName
        }
      }
      
      ConvertTo-Json -InputObject $result -Depth 3
    `;
    
    const result = await ps.runPS(script);
    if (result.success && result.output) {
      try {
        return JSON.parse(result.output);
      } catch {
        return null;
      }
    }
    return null;
  } catch (err) {
    console.warn('[ddos] Failed to get network stats:', err.message);
    return null;
  }
}

/**
 * Disconnect VM network adapter (mitigation action)
 */
async function disconnectVMNetwork(vmName) {
  try {
    const script = `
      $vm = Get-VM -Name '${vmName.replace(/'/g, "''")}' -ErrorAction Stop
      Get-VMNetworkAdapter -VM $vm | Disconnect-VMNetworkAdapter -ErrorAction Stop
      'Success'
    `;
    
    const result = await ps.runPS(script);
    return result.success;
  } catch (err) {
    console.error('[ddos] Failed to disconnect network:', err.message);
    return false;
  }
}

/**
 * Suspend VM (mitigation action)
 */
async function suspendVM(vmName) {
  try {
    const script = `Suspend-VM -Name '${vmName.replace(/'/g, "''")}' -ErrorAction Stop; 'Success'`;
    const result = await ps.runPS(script);
    return result.success;
  } catch (err) {
    console.error('[ddos] Failed to suspend VM:', err.message);
    return false;
  }
}

/**
 * Check if VM is in cooldown period (prevent alert spam)
 */
async function isInCooldown(vmName) {
  const lastAlert = await db.get(
    `SELECT created_at FROM ddos_events 
     WHERE vm_name = ? AND created_at > NOW() - INTERVAL ${CONFIG.ALERT_COOLDOWN_MINUTES} MINUTE
     ORDER BY created_at DESC LIMIT 1`,
    [vmName]
  );
  return !!lastAlert;
}

/**
 * Send alert notifications
 */
async function sendAlertNotifications(vmName, detectionType, details) {
  try {
    // Get alert settings
    const webhookUrl = (await db.get("SELECT value FROM settings WHERE `key` = 'ddos_alert_webhook'"))?.value;
    const emailTo = (await db.get("SELECT value FROM settings WHERE `key` = 'ddos_alert_email'"))?.value;
    
    const message = `[DDoS ALERT] ${vmName} - ${detectionType}\n${details}`;
    
    // Webhook notification
    if (webhookUrl) {
      try {
        const { URL } = require('url');
        const https = require('https');
        const http = require('http');
        const parsed = new URL(webhookUrl);
        const payload = JSON.stringify({
          vm_name: vmName,
          detection_type: detectionType,
          details,
          timestamp: new Date().toISOString(),
        });
        
        const lib = parsed.protocol === 'https:' ? https : http;
        await new Promise((resolve, reject) => {
          const req = lib.request({
            hostname: parsed.hostname,
            port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload),
            },
          }, resolve);
          req.on('error', reject);
          req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
          req.write(payload);
          req.end();
        });
        console.log('[ddos] Webhook notification sent');
      } catch (err) {
        console.warn('[ddos] Webhook failed:', err.message);
      }
    }
    
    // Email notification (reuse alert email configuration)
    if (emailTo) {
      try {
        const smtpHost = (await db.get("SELECT value FROM settings WHERE `key` = 'alert_smtp_host'"))?.value;
        if (!smtpHost) return;
        
        let nodemailer;
        try { nodemailer = require('nodemailer'); } catch { return; }
        
        const smtpPort = parseInt((await db.get("SELECT value FROM settings WHERE `key` = 'alert_smtp_port'"))?.value || '587');
        const smtpUser = (await db.get("SELECT value FROM settings WHERE `key` = 'alert_smtp_user'"))?.value;
        const smtpPass = (await db.get("SELECT value FROM settings WHERE `key` = 'alert_smtp_pass'"))?.value;
        const from = (await db.get("SELECT value FROM settings WHERE `key` = 'alert_email_from'"))?.value;
        if (!from) return;
        
        const transporter = nodemailer.createTransport({
          host: smtpHost,
          port: smtpPort,
          secure: smtpPort === 465,
          auth: smtpUser ? { user: smtpUser, pass: smtpPass } : undefined,
        });
        
        await transporter.sendMail({
          from,
          to: emailTo,
          subject: `DDoS Alert: ${vmName}`,
          text: message,
        });
        console.log('[ddos] Email notification sent');
      } catch (err) {
        console.warn('[ddos] Email failed:', err.message);
      }
    }
  } catch (err) {
    console.error('[ddos] Notification error:', err.message);
  }
}

/**
 * Log DDoS event to database
 */
async function logDDoSEvent(vmName, detectionType, severity, metrics, actionTaken) {
  try {
    await db.run(
      `INSERT INTO ddos_events (vm_name, detection_type, severity, metrics, action_taken)
       VALUES (?, ?, ?, ?, ?)`,
      [vmName, detectionType, severity, JSON.stringify(metrics), actionTaken]
    );
  } catch (err) {
    console.error('[ddos] Failed to log event:', err.message);
  }
}

/**
 * Main DDoS detection logic
 */
async function detectDDoS(vmName, currentBandwidth) {
  try {
    // Skip if in cooldown
    if (await isInCooldown(vmName)) {
      return { detected: false, reason: 'cooldown' };
    }
    
    // Get recent history
    const recentHistory = await getRecentBandwidth(vmName, CONFIG.SPIKE_WINDOW_MINUTES);
    if (recentHistory.length < 2) {
      return { detected: false, reason: 'insufficient_data' };
    }
    
    // Calculate current outbound rate
    const latest = recentHistory[0];
    const previous = recentHistory[1];
    const timeDiff = (new Date(latest.recorded_at) - new Date(previous.recorded_at)) / 1000;
    const bytesDiff = latest.bytes_out - previous.bytes_out;
    const currentRate = calculateRate(bytesDiff, timeDiff);
    
    // Check for bandwidth spike
    if (currentRate > CONFIG.OUTBOUND_SPIKE_THRESHOLD) {
      const baseline = await getBaselineBandwidth(vmName, CONFIG.BASELINE_WINDOW_HOURS);
      const avgRate = baseline.sample_count > 0 
        ? calculateRate(baseline.avg_bytes_out, 60) 
        : 0;
      
      const details = `Outbound spike detected: ${currentRate.toFixed(2)} MB/s (baseline: ${avgRate.toFixed(2)} MB/s)`;
      
      await logDDoSEvent(vmName, 'bandwidth_spike', 'high', {
        current_rate_mbps: currentRate,
        baseline_rate_mbps: avgRate,
        threshold_mbps: CONFIG.OUTBOUND_SPIKE_THRESHOLD,
      }, 'none');
      
      await sendAlertNotifications(vmName, 'High Outbound Bandwidth Spike', details);
      
      return {
        detected: true,
        type: 'bandwidth_spike',
        severity: 'high',
        details,
        currentRate,
      };
    }
    
    // Check for sustained high bandwidth
    const avgOutbound = recentHistory.reduce((sum, r) => sum + r.bytes_out, 0) / recentHistory.length;
    const avgRate = calculateRate(avgOutbound, 60);
    
    if (avgRate > CONFIG.OUTBOUND_SUSTAINED_THRESHOLD) {
      const details = `Sustained high outbound: ${avgRate.toFixed(2)} MB/s over ${CONFIG.SPIKE_WINDOW_MINUTES} minutes`;
      
      await logDDoSEvent(vmName, 'sustained_bandwidth', 'medium', {
        avg_rate_mbps: avgRate,
        duration_minutes: CONFIG.SPIKE_WINDOW_MINUTES,
        threshold_mbps: CONFIG.OUTBOUND_SUSTAINED_THRESHOLD,
      }, 'none');
      
      await sendAlertNotifications(vmName, 'Sustained High Outbound Traffic', details);
      
      return {
        detected: true,
        type: 'sustained_bandwidth',
        severity: 'medium',
        details,
        avgRate,
      };
    }
    
    return { detected: false };
  } catch (err) {
    console.error('[ddos] Detection error:', err.message);
    return { detected: false, error: err.message };
  }
}

/**
 * Take automated action based on detection
 */
async function takeAction(vmName, detection) {
  if (CONFIG.ALERT_ONLY) {
    console.log(`[ddos] Alert-only mode, no automated action for ${vmName}`);
    return 'alert_only';
  }
  
  let actionTaken = 'none';
  
  if (CONFIG.AUTO_DISCONNECT_NETWORK) {
    console.log(`[ddos] Disconnecting network for ${vmName}`);
    const success = await disconnectVMNetwork(vmName);
    if (success) {
      actionTaken = 'network_disconnected';
      await db.run(
        `INSERT INTO audit_logs (username, action, vm_name, details, status)
         VALUES ('SYSTEM', 'ddos_mitigation', ?, 'Network disconnected due to DDoS detection', 'success')`,
        [vmName]
      );
    }
  }
  
  if (CONFIG.AUTO_SUSPEND_ENABLED && detection.severity === 'high') {
    console.log(`[ddos] Suspending VM ${vmName}`);
    const success = await suspendVM(vmName);
    if (success) {
      actionTaken = 'vm_suspended';
      await db.run(
        `INSERT INTO audit_logs (username, action, vm_name, details, status)
         VALUES ('SYSTEM', 'ddos_mitigation', ?, 'VM suspended due to DDoS detection', 'success')`,
        [vmName]
      );
    }
  }
  
  // Update event log with action taken
  await db.run(
    `UPDATE ddos_events SET action_taken = ? 
     WHERE vm_name = ? AND created_at = (
       SELECT MAX(created_at) FROM ddos_events WHERE vm_name = ?
     )`,
    [actionTaken, vmName, vmName]
  );
  
  return actionTaken;
}

/**
 * Scan all running VMs for DDoS activity
 */
async function scanAllVMs() {
  try {
    // Get all assigned running VMs
    const assignments = await db.all('SELECT DISTINCT vm_name FROM user_vm_access UNION SELECT DISTINCT vm_name FROM vm_client_assignments');
    const vmNames = assignments.map(a => a.vm_name);
    
    if (vmNames.length === 0) return;
    
    for (const vmName of vmNames) {
      const detection = await detectDDoS(vmName, null);
      
      if (detection.detected) {
        console.log(`[ddos] ⚠️  Detection for ${vmName}:`, detection.type);
        await takeAction(vmName, detection);
      }
    }
  } catch (err) {
    console.error('[ddos] Scan error:', err.message);
  }
}

/**
 * Get DDoS configuration
 */
function getConfig() {
  return { ...CONFIG };
}

/**
 * Update DDoS configuration
 */
function updateConfig(newConfig) {
  Object.assign(CONFIG, newConfig);
  console.log('[ddos] Configuration updated:', CONFIG);
}

module.exports = {
  detectDDoS,
  scanAllVMs,
  getConfig,
  updateConfig,
  disconnectVMNetwork,
  suspendVM,
};
