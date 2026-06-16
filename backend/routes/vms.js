const express = require('express');
const router  = express.Router();
const ps      = require('../utils/powershell');
const db      = require('../utils/database');
const rdpConsole = require('../utils/rdpConsole');
const { authMiddleware, requireOperator, requireAdmin, requireOperatorOrAssignedViewer } = require('../middleware/auth');
const { auditLog } = require('../middleware/audit');

async function assertConsoleAccess(req, vmName) {
  if (req.user && (req.user.role === 'user' || req.user.role === 'viewer')) {
    const row = await db.get(
      'SELECT 1 AS ok FROM user_vm_access WHERE user_id = ? AND vm_name = ?',
      [req.user.id, vmName]
    );
    if (!row) {
      const err = new Error('Access denied for this VM');
      err.status = 403;
      throw err;
    }
  }

  const flagRow = await db.get("SELECT value FROM settings WHERE `key` = 'discord_whitelist_enabled'");
  if (String(flagRow?.value || '0') !== '1') return;

  const dbUser = await db.get('SELECT discord_id FROM users WHERE id = ?', [req.user.id]);
  const discordId = dbUser?.discord_id || null;
  if (!discordId) {
    const err = new Error('Discord account must be linked for console access');
    err.status = 403;
    throw err;
  }
  const allowed = await db.get('SELECT 1 AS ok FROM discord_whitelist WHERE discord_id = ?', [discordId]);
  if (!allowed) {
    const err = new Error('Your Discord account is not whitelisted for console access');
    err.status = 403;
    throw err;
  }
}

async function filterVmList(vms, user) {
  const showAllRow = await db.get("SELECT value FROM settings WHERE `key` = 'show_all_vms'");
  const showAll = showAllRow?.value === '1';

  console.log(`[filterVmList] showAll=${showAll}, input VMs count=${vms.length}`);

  if (!showAll) {
    const rootsEnv = (process.env.VM_ROOTS || '').trim();
    const dbRoots = (await db.all('SELECT path FROM vm_roots ORDER BY path')).map(r => r.path);
    const combined = [rootsEnv, ...dbRoots].filter(Boolean).join(';');
    
    console.log(`[filterVmList] VM_ROOTS env: "${rootsEnv}"`);
    console.log(`[filterVmList] DB roots: [${dbRoots.join(', ')}]`);
    console.log(`[filterVmList] Combined: "${combined}"`);
    
    if (combined) {
      const normalize = p => {
        if (!p || typeof p !== 'string') return '';
        let s = p.replace(/\//g, '\\').trim();
        if (s.startsWith('\\\\?\\')) s = s.slice(4);
        while (s.endsWith('\\')) s = s.slice(0, -1);
        return s.toLowerCase();
      };
      const roots = combined.split(';').map(normalize).filter(Boolean);
      console.log(`[filterVmList] Normalized roots: [${roots.join(', ')}]`);
      
      const ok = p => { 
        const lp = normalize(p); 
        const match = roots.some(r => lp === r || lp.startsWith(r + '\\'));
        if (!match) console.log(`[filterVmList] Path "${p}" normalized to "${lp}" - NO MATCH`);
        return match;
      };
      
      const beforeCount = vms.length;
      vms = vms.filter(v => {
        const pathOk = ok(v.Path);
        const configOk = ok(v.ConfigurationLocation);
        const vhdOk = (Array.isArray(v.VHDPaths) ? v.VHDPaths : (v.VHDPaths ? [v.VHDPaths] : [])).some(ok);
        const result = pathOk || configOk || vhdOk;
        
        console.log(`[filterVmList] VM "${v.Name}": Path="${v.Path}", Config="${v.ConfigurationLocation}", VHDs=[${v.VHDPaths}] -> ${result ? 'KEEP' : 'FILTER OUT'}`);
        
        return result;
      });
      console.log(`[filterVmList] Filtered by paths: ${beforeCount} -> ${vms.length} VMs`);
    }
  }

  if (user && (user.role === 'user' || user.role === 'viewer')) {
    const rows = await db.all('SELECT vm_name FROM user_vm_access WHERE user_id = ?', [user.id]);
    const allowed = new Set(rows.map(r => r.vm_name));
    const beforeCount = vms.length;
    vms = vms.filter(v => allowed.has(v.Name));
    console.log(`[filterVmList] Filtered by user access: ${beforeCount} -> ${vms.length} VMs`);
  }

  console.log(`[filterVmList] Final count: ${vms.length}`);
  return vms;
}

router.use(authMiddleware);

// ─── Static routes MUST come before /:name — Express matches in order ─────────

// GET /vms/roots
router.get('/roots', requireAdmin, async (req, res) => {
  const env    = (process.env.VM_ROOTS || '').trim();
  const envList = env ? env.split(';').map(s => s.trim()).filter(Boolean) : [];
  const dbList  = await db.all('SELECT id, path FROM vm_roots ORDER BY path');
  res.json({ env: envList, db: dbList });
});

// GET /vms/debug-filter - Debug endpoint to see filtering in action
router.get('/debug-filter', requireAdmin, async (req, res) => {
  try {
    const ps = require('../utils/powershell');
    const allVms = await ps.listVMs();
    
    const showAllRow = await db.get("SELECT value FROM settings WHERE `key` = 'show_all_vms'");
    const showAll = showAllRow?.value === '1';
    
    const rootsEnv = (process.env.VM_ROOTS || '').trim();
    const dbRoots = (await db.all('SELECT path FROM vm_roots ORDER BY path')).map(r => r.path);
    const combined = [rootsEnv, ...dbRoots].filter(Boolean).join(';');
    
    const normalize = p => {
      if (!p || typeof p !== 'string') return '';
      let s = p.replace(/\//g, '\\').trim();
      if (s.startsWith('\\\\?\\')) s = s.slice(4);
      while (s.endsWith('\\')) s = s.slice(0, -1);
      return s.toLowerCase();
    };
    
    const roots = combined ? combined.split(';').map(normalize).filter(Boolean) : [];
    
    const debug = {
      showAll,
      vm_roots_env: rootsEnv,
      db_roots: dbRoots,
      combined_roots: combined,
      normalized_roots: roots,
      total_vms: allVms.length,
      vms: allVms.map(v => ({
        name: v.Name,
        path: v.Path,
        path_normalized: normalize(v.Path),
        config: v.ConfigurationLocation,
        config_normalized: normalize(v.ConfigurationLocation),
        vhd_paths: v.VHDPaths,
        matches_root: roots.length === 0 ? null : roots.some(r => {
          const lp = normalize(v.Path);
          const lc = normalize(v.ConfigurationLocation);
          return lp === r || lp.startsWith(r + '\\') || lc === r || lc.startsWith(r + '\\');
        })
      }))
    };
    
    res.json(debug);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/roots', requireAdmin, async (req, res) => {
  const p = (req.body?.path || '').trim();
  if (!p) return res.status(400).json({ error: 'path is required' });
  try {
    const { insertId } = await db.run('INSERT INTO vm_roots (path) VALUES (?)', [p]);
    res.status(201).json({ id: insertId, path: p });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /vms/discover — list ALL VMs from Hyper-V (for admin to manually assign)
router.get('/discover', requireAdmin, async (req, res) => {
  try {
    // Query Hyper-V directly for all VMs
    const allVMs = await ps.listVMs();
    
    // Get list of already assigned VMs
    const userAssignments = await db.all('SELECT DISTINCT vm_name FROM user_vm_access');
    const clientAssignments = await db.all('SELECT DISTINCT vm_name FROM vm_client_assignments');
    const assigned = new Set([
      ...userAssignments.map(r => r.vm_name),
      ...clientAssignments.map(r => r.vm_name)
    ]);

    // Mark each VM as assigned or unassigned
    const vmsWithStatus = allVMs.map(vm => ({
      ...vm,
      is_assigned: assigned.has(vm.Name)
    }));

    res.json(vmsWithStatus);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/roots/:id', requireAdmin, async (req, res) => {
  try { await db.run('DELETE FROM vm_roots WHERE id = ?', [parseInt(req.params.id)]); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /vms — query ONLY assigned VMs directly from Hyper-V (fast!)
router.get('/', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    
    // Get list of VMs assigned to this user (or all if admin/operator)
    let assignedVmNames = [];
    
    if (req.user.role === 'admin' || req.user.role === 'operator') {
      // Admins/operators see all assigned VMs (from both user and client assignments)
      const userAssignments = await db.all('SELECT DISTINCT vm_name FROM user_vm_access');
      const clientAssignments = await db.all('SELECT DISTINCT vm_name FROM vm_client_assignments');
      assignedVmNames = [
        ...userAssignments.map(r => r.vm_name),
        ...clientAssignments.map(r => r.vm_name)
      ];
    } else {
      // Regular users/viewers only see their assigned VMs
      const rows = await db.all('SELECT vm_name FROM user_vm_access WHERE user_id = ?', [req.user.id]);
      assignedVmNames = rows.map(r => r.vm_name);
    }

    if (assignedVmNames.length === 0) {
      return res.json([]);
    }

    // Query ONLY the specific assigned VMs — much faster than Get-VM | Get-VMHardDiskDrive on all VMs
    let vms = await ps.listSpecificVMs(assignedVmNames);
    
    // Apply additional filters (VM roots, etc.)
    vms = await filterVmList(vms, req.user);

    res.json(vms);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /vms/:name
router.get('/:name', async (req, res) => {
  try {
    if (req.user && (req.user.role === 'user' || req.user.role === 'viewer')) {
      const row = await db.get('SELECT 1 AS ok FROM user_vm_access WHERE user_id = ? AND vm_name = ?', [req.user.id, req.params.name]);
      if (!row) return res.status(403).json({ error: 'Access denied for this VM' });
    }
    res.json(await ps.getVMDetails(req.params.name));
  } catch (err) {
    if (err.message.includes('Invalid VM name')) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

const vmAction = (fn, action) => [requireOperatorOrAssignedViewer, auditLog({ action }), async (req, res) => {
  try {
    await fn(req);
    res.json({ success: true, action, vm: req.params.name });
  } catch (err) {
    if (err.message.includes('Invalid VM name')) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
}];

router.post('/:name/start',   ...vmAction(req => ps.startVM(req.params.name), 'VM_START'));
router.post('/:name/stop',    ...vmAction(req => ps.stopVM(req.params.name, req.body?.force === true), 'VM_STOP'));
router.post('/:name/restart', ...vmAction(req => ps.restartVM(req.params.name, req.body?.force === true), 'VM_RESTART'));
router.post('/:name/suspend', ...vmAction(req => ps.suspendVM(req.params.name), 'VM_SUSPEND'));
router.post('/:name/resume',  ...vmAction(req => ps.resumeVM(req.params.name), 'VM_RESUME'));

// Snapshots
router.get('/:name/snapshots', async (req, res) => {
  try {
    if (req.user && (req.user.role === 'user' || req.user.role === 'viewer')) {
      const row = await db.get('SELECT 1 AS ok FROM user_vm_access WHERE user_id = ? AND vm_name = ?', [req.user.id, req.params.name]);
      if (!row) return res.status(403).json({ error: 'Access denied for this VM' });
    }
    res.json(await ps.listSnapshots(req.params.name));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:name/snapshots', requireOperator, auditLog({ action: 'SNAPSHOT_CREATE' }), async (req, res) => {
  const { snapshotName } = req.body;
  if (!snapshotName) return res.status(400).json({ error: 'snapshotName is required' });
  try {
    const maxSnapshots = Math.max(1, parseInt(process.env.MAX_VM_SNAPSHOTS || '20', 10));
    const existing = await ps.listSnapshots(req.params.name);
    if (existing.length >= maxSnapshots) {
      return res.status(400).json({ error: `Snapshot limit reached (${maxSnapshots}). Delete old snapshots first.` });
    }
    await ps.createSnapshot(req.params.name, snapshotName);
    res.json({ success: true });
  } catch (err) {
    if (err.message.includes('Invalid')) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.post('/:name/snapshots/:snapshotName/restore', requireOperator, auditLog({ action: 'SNAPSHOT_RESTORE' }), async (req, res) => {
  try {
    const vm = await ps.getVMDetails(req.params.name);
    const force = req.body?.force === true;
    if (vm?.State === 'Running' && !force) {
      return res.status(409).json({ error: 'VM is running. Stop the VM or retry with force=true.' });
    }
    await ps.restoreSnapshot(req.params.name, req.params.snapshotName);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:name/snapshots/:snapshotName', requireOperator, auditLog({ action: 'SNAPSHOT_DELETE' }), async (req, res) => {
  try { await ps.deleteSnapshot(req.params.name, req.params.snapshotName); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Password reset
router.post('/:name/reset-password', requireOperator, auditLog({ action: 'VM_RESET_PASSWORD' }), async (req, res) => {
  const { guestUser, guestPassword, targetUser, newPassword } = req.body || {};
  if (!guestUser || !guestPassword || !targetUser || !newPassword)
    return res.status(400).json({ error: 'guestUser, guestPassword, targetUser, and newPassword are all required' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
  try { await ps.resetVMPassword(req.params.name, guestUser, guestPassword, targetUser, newPassword); res.json({ success: true }); }
  catch (err) {
    if (err.message.includes('Invalid') || err.message.includes('disallowed')) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// Emergency reset
router.post('/:name/emergency-reset-password', requireAdmin, auditLog({ action: 'VM_EMERGENCY_RESET_PASSWORD' }), async (req, res) => {
  const { targetUser, newPassword, restartAfter = true } = req.body || {};
  if (!targetUser || !newPassword) return res.status(400).json({ error: 'targetUser and newPassword are required' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
  req.setTimeout(300000);
  res.setTimeout(300000);
  try {
    const output = await ps.emergencyResetVMPassword(req.params.name, targetUser, newPassword, restartAfter === true || restartAfter === 'true');
    res.json({ success: true, detail: output });
  } catch (err) {
    if (err.message.includes('Invalid') || err.message.includes('disallowed')) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// GET /vms/:name/rdp-info
router.get('/:name/rdp-info', async (req, res) => {
  try {
    const guid = await ps.getVMGuid(req.params.name);
    res.json({ vmName: req.params.name, guid });
  } catch (err) {
    if (err.message.includes('Invalid VM name')) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// GET /vms/:name/console-session
router.get('/:name/console-session', async (req, res) => {
  try {
    await assertConsoleAccess(req, req.params.name);

    const override = await db.get(
      'SELECT rdp_port, rdp_host, rdp_username, rdp_password, use_manual FROM vm_console_overrides WHERE vm_name = ?',
      [req.params.name]
    );
    const useManual = override?.use_manual === 1;

    let mode, port;
    if (useManual && override?.rdp_host) {
      const setting = await db.get("SELECT value FROM settings WHERE `key` = 'console_rdp_port'");
      port = String(override?.rdp_port || setting?.value || '3389');
      mode = 'rdp';
    } else {
      await ps.getVMGuid(req.params.name);
      mode = 'vmconnect';
      port = '2179';
    }

    res.json({
      mode,
      ws_path: rdpConsole.getWsPath(),
      vm_name: req.params.name,
      use_manual: useManual,
      rdp_host: useManual ? (override?.rdp_host || '') : null,
      port,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (err.message.includes('Invalid VM name')) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// GET /vms/:name/console-url
router.get('/:name/console-url', async (req, res) => {
  try {
    await assertConsoleAccess(req, req.params.name);

    const settingsRows = await db.all(
      "SELECT `key`, value FROM settings WHERE `key` IN ('console_url_template', 'console_rdp_port')"
    );
    const settings = Object.fromEntries(settingsRows.map(r => [r.key, r.value]));
    const template = String(settings.console_url_template || '').trim();
    const defaultPort = settings.console_rdp_port || '3389';

    const override = await db.get(
      'SELECT rdp_port, rdp_host, rdp_username, use_manual FROM vm_console_overrides WHERE vm_name = ?',
      [req.params.name]
    );

    const useManual = override?.use_manual === 1;
    const rdpPort = String(override?.rdp_port || defaultPort).trim();
    const rdpUsername = override?.rdp_username || '';

    let targetHost = '', vmIP = '';
    if (useManual && override?.rdp_host) {
      targetHost = override.rdp_host;
    } else {
      const vm = await ps.getVMDetails(req.params.name);
      if (vm.NetworkAdapters?.length) {
        for (const nic of vm.NetworkAdapters) {
          const ips = Array.isArray(nic.IPAddresses) ? nic.IPAddresses : (nic.IPAddresses ? nic.IPAddresses.split(',') : []);
          const ipv4 = ips.map(ip => String(ip || '').trim()).find(ip =>
            /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip) && !ip.startsWith('169.254') && ip !== '127.0.0.1'
          );
          if (ipv4) { vmIP = ipv4; break; }
        }
      }
      targetHost = vmIP;
    }

    if (!targetHost) {
      return res.status(400).json({
        error: useManual
          ? 'Manual RDP host is not configured. Set it in the console settings tab.'
          : 'VM IP not detected. Make sure VM is running and Integration Services are enabled, or configure a manual host.'
      });
    }

    if (!template) {
      return res.status(400).json({ error: 'Browser RDP is not configured. Set a console URL template in Settings.' });
    }

    const finalUrl = template
      .replaceAll('{host}', encodeURIComponent(targetHost))
      .replaceAll('{port}', encodeURIComponent(rdpPort))
      .replaceAll('{vm}', encodeURIComponent(req.params.name))
      .replaceAll('{username}', encodeURIComponent(rdpUsername));

    res.json({ url: finalUrl, vmIP: useManual ? null : vmIP, rdp_host: targetHost, port: rdpPort, username: rdpUsername, use_manual: useManual });
  } catch (err) {
    if (err.message.includes('Invalid VM name')) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// GET /vms/:name/console-config
router.get('/:name/console-config', requireOperatorOrAssignedViewer, async (req, res) => {
  try {
    const setting = await db.get("SELECT value FROM settings WHERE `key` = 'console_rdp_port'");
    const defaultPort = String(setting?.value || '3389');

    const vm = await ps.getVMDetails(req.params.name);
    let autoIP = '';
    if (vm.NetworkAdapters?.length) {
      for (const nic of vm.NetworkAdapters) {
        const ips = Array.isArray(nic.IPAddresses) ? nic.IPAddresses : (nic.IPAddresses ? nic.IPAddresses.split(',') : []);
        const ipv4 = ips.map(ip => String(ip || '').trim()).find(ip =>
          /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip) && !ip.startsWith('169.254') && ip !== '127.0.0.1'
        );
        if (ipv4) { autoIP = ipv4; break; }
      }
    }

    const override = await db.get(
      'SELECT rdp_port, rdp_host, rdp_username, rdp_password, use_manual, updated_at FROM vm_console_overrides WHERE vm_name = ?',
      [req.params.name]
    );

    if (!override) {
      return res.json({ vm_name: req.params.name, auto_ip: autoIP, default_rdp_port: defaultPort, rdp_port: defaultPort, rdp_host: '', rdp_username: '', rdp_password: '', use_manual: false, updated_at: null });
    }

    return res.json({
      vm_name: req.params.name,
      auto_ip: autoIP,
      default_rdp_port: defaultPort,
      rdp_port: String(override.rdp_port || defaultPort),
      rdp_host: override.rdp_host || '',
      rdp_username: override.rdp_username || '',
      rdp_password: override.rdp_password ? '[ENCRYPTED]' : '',
      use_manual: override.use_manual === 1,
      updated_at: override.updated_at,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /vms/:name/console-config
router.put('/:name/console-config', requireAdmin, async (req, res) => {
  try {
    const { rdp_port, rdp_host, rdp_username, rdp_password, use_manual } = req.body || {};

    let port = 3389;
    if (rdp_port !== undefined && rdp_port !== null && String(rdp_port).trim() !== '') {
      port = parseInt(rdp_port, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        return res.status(400).json({ error: 'rdp_port must be a valid TCP port (1-65535)' });
      }
    }

    const shouldClear = !rdp_host && !rdp_username && (!rdp_password || rdp_password === '[ENCRYPTED]') &&
                        (rdp_port === undefined || rdp_port === null || String(rdp_port).trim() === '');

    if (shouldClear) {
      await db.run('DELETE FROM vm_console_overrides WHERE vm_name = ?', [req.params.name]);
      return res.json({ success: true, cleared: true });
    }

    const useManualValue = use_manual === true ? 1 : 0;
    const hostValue = rdp_host || '';
    const usernameValue = rdp_username || '';
    const passwordValue = (rdp_password && rdp_password !== '[ENCRYPTED]') ? rdp_password : null;

    if (passwordValue) {
      await db.run(
        `INSERT INTO vm_console_overrides (vm_name, rdp_port, rdp_host, rdp_username, rdp_password, use_manual, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE rdp_port=VALUES(rdp_port), rdp_host=VALUES(rdp_host), rdp_username=VALUES(rdp_username),
           rdp_password=VALUES(rdp_password), use_manual=VALUES(use_manual), updated_by=VALUES(updated_by)`,
        [req.params.name, port, hostValue, usernameValue, passwordValue, useManualValue, req.user.id]
      );
    } else {
      await db.run(
        `INSERT INTO vm_console_overrides (vm_name, rdp_port, rdp_host, rdp_username, use_manual, updated_by)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE rdp_port=VALUES(rdp_port), rdp_host=VALUES(rdp_host), rdp_username=VALUES(rdp_username),
           use_manual=VALUES(use_manual), updated_by=VALUES(updated_by)`,
        [req.params.name, port, hostValue, usernameValue, useManualValue, req.user.id]
      );
    }

    res.json({ success: true, rdp_port: String(port), rdp_host: hostValue, rdp_username: usernameValue, use_manual: useManualValue === 1, cleared: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
