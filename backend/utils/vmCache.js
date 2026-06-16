/**
 * VM list cache — sync from Hyper-V in the background, serve API reads from MySQL.
 * Avoids spawning PowerShell on every dashboard poll (which times out with many VMs).
 */

const db = require('./database');
const ps = require('./powershell');

let syncing = false;
let syncTimer = null;
let debounceTimer = null;
let lastSyncedAt = null;
let lastError = null;
let intervalId = null;

function parseJson(val, fallback = null) {
  if (!val) return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}

function rowToVm(row) {
  return {
    Name: row.name,
    State: row.state,
    CPUUsage: Number(row.cpu_usage) || 0,
    MemoryAssignedGB: Number(row.memory_assigned_gb) || 0,
    MemoryDemandGB: Number(row.memory_demand_gb) || 0,
    Uptime: parseJson(row.uptime_json),
    Status: row.status,
    Version: row.version,
    Generation: row.generation,
    ProcessorCount: row.processor_count,
    Path: row.path,
    ConfigurationLocation: row.configuration_location,
    VHDPaths: parseJson(row.vhd_paths_json, []),
  };
}

function vmToRow(vm) {
  const vhdPaths = vm.VHDPaths == null ? [] : (Array.isArray(vm.VHDPaths) ? vm.VHDPaths : [vm.VHDPaths]);
  return {
    name: vm.Name,
    state: vm.State || 'Unknown',
    cpu_usage: vm.CPUUsage || 0,
    memory_assigned_gb: vm.MemoryAssignedGB || 0,
    memory_demand_gb: vm.MemoryDemandGB || 0,
    uptime_json: vm.Uptime ? JSON.stringify(vm.Uptime) : null,
    status: vm.Status || null,
    version: vm.Version != null ? String(vm.Version) : null,
    generation: vm.Generation != null ? Number(vm.Generation) : null,
    processor_count: vm.ProcessorCount != null ? Number(vm.ProcessorCount) : null,
    path: vm.Path || null,
    configuration_location: vm.ConfigurationLocation || null,
    vhd_paths_json: JSON.stringify(vhdPaths.filter(Boolean)),
  };
}

async function getIntervalMs() {
  const row = await db.get("SELECT value FROM settings WHERE `key` = 'vm_cache_interval_sec'");
  // Default to 3s for near-real-time updates. Min is 2s to avoid hammering PowerShell.
  // This keeps MySQL fast (~10ms reads) while state stays accurate within 3 seconds.
  const sec = Math.max(2, parseInt(row?.value || process.env.VM_CACHE_INTERVAL_SEC || '3', 10));
  return sec * 1000;
}

async function syncVMs() {
  if (syncing) return { skipped: true };
  syncing = true;
  lastError = null;

  try {
    // Get list of VMs that are actually assigned to users or clients
    const assignedVMs = new Set();
    
    // VMs assigned to users (user_vm_access)
    const userAssignments = await db.all('SELECT DISTINCT vm_name FROM user_vm_access');
    userAssignments.forEach(row => assignedVMs.add(row.vm_name));
    
    // VMs assigned to clients (vm_client_assignments)
    const clientAssignments = await db.all('SELECT DISTINCT vm_name FROM vm_client_assignments');
    clientAssignments.forEach(row => assignedVMs.add(row.vm_name));

    if (assignedVMs.size === 0) {
      console.log('[vm-cache] No VMs assigned to any user or client, skipping sync');
      lastSyncedAt = new Date();
      return { count: 0, synced_at: lastSyncedAt };
    }

    // Query Hyper-V for ALL VMs, then filter to only assigned ones
    const allVMs = await ps.listVMs();
    const vms = allVMs.filter(vm => assignedVMs.has(vm.Name));
    const names = vms.map(v => v.Name).filter(Boolean);

    console.log(`[vm-cache] syncing ${vms.length} assigned VM(s) (${assignedVMs.size} total assignments): ${names.map(n => `${n}(${vms.find(v => v.Name === n)?.State || 'Unknown'})`).join(', ')}`);

    for (const vm of vms) {
      const r = vmToRow(vm);
      await db.run(
        `INSERT INTO vm_cache (
          name, state, cpu_usage, memory_assigned_gb, memory_demand_gb,
          uptime_json, status, version, generation, processor_count,
          path, configuration_location, vhd_paths_json, synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE
          state=VALUES(state), cpu_usage=VALUES(cpu_usage),
          memory_assigned_gb=VALUES(memory_assigned_gb), memory_demand_gb=VALUES(memory_demand_gb),
          uptime_json=VALUES(uptime_json), status=VALUES(status), version=VALUES(version),
          generation=VALUES(generation), processor_count=VALUES(processor_count),
          path=VALUES(path), configuration_location=VALUES(configuration_location),
          vhd_paths_json=VALUES(vhd_paths_json), synced_at=NOW()`,
        [
          r.name, r.state, r.cpu_usage, r.memory_assigned_gb, r.memory_demand_gb,
          r.uptime_json, r.status, r.version, r.generation, r.processor_count,
          r.path, r.configuration_location, r.vhd_paths_json,
        ]
      );
    }

    // Clean up: remove VMs from cache that are no longer assigned OR don't exist in Hyper-V
    if (names.length) {
      const placeholders = names.map(() => '?').join(',');
      await db.run(`DELETE FROM vm_cache WHERE name NOT IN (${placeholders})`, names);
    } else {
      await db.run('DELETE FROM vm_cache');
    }

    lastSyncedAt = new Date();
    return { count: vms.length, synced_at: lastSyncedAt };
  } catch (err) {
    lastError = err.message;
    console.warn('[vm-cache] sync failed:', err.message);
    throw err;
  } finally {
    syncing = false;
  }
}

async function getCachedVMs() {
  const rows = await db.all('SELECT * FROM vm_cache ORDER BY name ASC');
  return rows.map(rowToVm);
}

function getStatus() {
  return {
    syncing,
    synced_at: lastSyncedAt ? lastSyncedAt.toISOString() : null,
    last_error: lastError,
  };
}

function scheduleSync(delayMs = 3000) {
  if (delayMs <= 0) {
    syncVMs().catch(() => {});
    return;
  }
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    syncVMs().catch(() => {});
  }, delayMs);
}

async function ensureFresh() {
  const countRow = await db.get('SELECT COUNT(*) AS c FROM vm_cache');
  if ((countRow?.c || 0) === 0 && !syncing) {
    syncVMs().catch(() => {});
  }
}

async function start() {
  const intervalMs = await getIntervalMs();
  const tick = () => syncVMs().catch(() => {});

  syncTimer = setTimeout(tick, 5000);
  intervalId = setInterval(tick, intervalMs);

  console.log(`✓ VM cache sync started (${intervalMs / 1000}s interval)`);
}

module.exports = {
  syncVMs,
  getCachedVMs,
  getStatus,
  scheduleSync,
  ensureFresh,
  start,
};
