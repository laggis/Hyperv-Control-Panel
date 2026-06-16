const { PowerShell } = require('node-powershell');

// Sanitize VM names to prevent PowerShell injection
function sanitizeVMName(name) {
  if (typeof name !== 'string') throw new Error('VM name must be a string');
  if (!/^[a-zA-Z0-9\s\-_.]+$/.test(name)) {
    throw new Error(`Invalid VM name: "${name}". Only alphanumeric, spaces, hyphens, underscores, and dots are allowed.`);
  }
  if (name.length > 100) throw new Error('VM name too long');
  return name.trim();
}

function sanitizeSnapshotName(name) {
  if (typeof name !== 'string') throw new Error('Snapshot name must be a string');
  if (!/^[a-zA-Z0-9\s\-_.()[\]]+$/.test(name)) {
    throw new Error('Invalid snapshot name.');
  }
  if (name.length > 200) throw new Error('Snapshot name too long');
  return name.trim();
}

// IMPORTANT: PowerShell 5.1 (Windows Server 2016/2019) does NOT allow
// a pipe character `|` at the START of a new line. All pipes must be
// at the END of the preceding line. Commands here are kept single-line
// or use semicolons to avoid this issue entirely.
async function runPS(command, timeoutMs = 30000) {
  try {
    const result = await PowerShell.invoke(command, {
      executionPolicy: process.env.PS_EXECUTION_POLICY || 'Bypass',
      noProfile: true,
    });
    return { success: true, output: result.raw };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
}

async function runPSLong(command) {
  // For long-running operations (VM stop, VHD mount) — no timeout wrapper,
  // relies on the caller's own deadline logic in the PS script itself.
  try {
    const result = await PowerShell.invoke(command, {
      executionPolicy: process.env.PS_EXECUTION_POLICY || 'Bypass',
      noProfile: true,
    });
    return { success: true, output: result.raw };
  } catch (err) {
    // Include any stdout the script printed before it threw — critical for debugging
    const stdout = err.stdout || err.raw || '';
    const msg    = err.message || String(err);
    const full   = stdout ? `${msg}\n--- Script output ---\n${stdout}` : msg;
    return { success: false, error: full };
  }
}

function bytesToGB(bytes) {
  if (!bytes || bytes === 0) return 0;
  return Math.round((bytes / 1073741824) * 100) / 100;
}

function parseJsonSafe(raw) {
  const trimmed = (raw || '').trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function mapVmList(vms) {
  return vms.map(vm => ({
    ...vm,
    MemoryAssignedGB: bytesToGB(vm.MemoryAssigned),
    MemoryDemandGB: bytesToGB(vm.MemoryDemand),
  }));
}

// Fast batch query — one Get-VMHardDiskDrive pass instead of per-VM calls.
const LIST_VMS_PS = [
  '$vhdMap=@{}',
  'Get-VMHardDiskDrive | ForEach-Object { if(-not $vhdMap.ContainsKey($_.VMName)){$vhdMap[$_.VMName]=@()}; $vhdMap[$_.VMName]+=$_.Path }',
  '$out=@()',
  'Get-VM | ForEach-Object { $p=$vhdMap[$_.Name]; $out+= [PSCustomObject]@{ Name=$_.Name; State=$_.State; CPUUsage=$_.CPUUsage; MemoryAssigned=$_.MemoryAssigned; MemoryDemand=$_.MemoryDemand; Uptime=$_.Uptime; Status=$_.Status; Version=$_.Version; Generation=$_.Generation; ProcessorCount=$_.ProcessorCount; Path=$_.Path; ConfigurationLocation=$_.ConfigurationLocation; VHDPaths=$p } }',
  'ConvertTo-Json -InputObject $out -Depth 5',
].join('; ');

async function listVMs() {
  const result = await runPSLong(LIST_VMS_PS);
  if (!result.success) throw new Error(result.error);
  return mapVmList(parseJsonSafe(result.output));
}

// Fast query for specific VMs by name — much faster than listing all VMs
async function listSpecificVMs(vmNames) {
  if (!vmNames || vmNames.length === 0) return [];
  
  // Escape VM names and build PowerShell array
  const names = vmNames.map(name => `'${sanitizeVMName(name).replace(/'/g, "''")}'`).join(',');
  
  const script = [
    `$names = @(${names})`,
    '$vhdMap=@{}',
    `$names | ForEach-Object { $vhds = Get-VMHardDiskDrive -VMName $_ -ErrorAction SilentlyContinue; if($vhds){ $vhdMap[$_] = @($vhds | Select-Object -ExpandProperty Path) } }`,
    '$out=@()',
    `$names | ForEach-Object { $vm = Get-VM -Name $_ -ErrorAction SilentlyContinue; if($vm){ $p=$vhdMap[$vm.Name]; $out+= [PSCustomObject]@{ Name=$vm.Name; State=$vm.State; CPUUsage=$vm.CPUUsage; MemoryAssigned=$vm.MemoryAssigned; MemoryDemand=$vm.MemoryDemand; Uptime=$vm.Uptime; Status=$vm.Status; Version=$vm.Version; Generation=$vm.Generation; ProcessorCount=$vm.ProcessorCount; Path=$vm.Path; ConfigurationLocation=$vm.ConfigurationLocation; VHDPaths=$p } } }`,
    'ConvertTo-Json -InputObject $out -Depth 5',
  ].join('; ');
  
  const result = await runPS(script, 15000);
  if (!result.success) throw new Error(result.error);
  return mapVmList(parseJsonSafe(result.output));
}

async function getVMDetails(vmName) {
  const name = sanitizeVMName(vmName);

  // VM base info - single line
  const vmResult = await runPS(
    `Get-VM -Name "${name}" | Select-Object Name, State, CPUUsage, MemoryAssigned, MemoryDemand, ProcessorCount, Uptime, Status, Generation, Version, Path, ConfigurationLocation | ConvertTo-Json -Depth 3`
  );
  if (!vmResult.success) throw new Error(vmResult.error);

  const vm = JSON.parse(vmResult.output.trim());
  vm.MemoryAssignedGB = bytesToGB(vm.MemoryAssigned);
  vm.MemoryDemandGB = bytesToGB(vm.MemoryDemand);

  // Drives - use semicolons instead of newlines to keep PS 5.1 happy
  const drivesResult = await runPS(
    `$out = @(); Get-VMHardDiskDrive -VMName "${name}" | ForEach-Object { $vhd = Get-VHD -Path $_.Path -ErrorAction SilentlyContinue; $out += [PSCustomObject]@{ Path=$_.Path; ControllerType=$_.ControllerType; SizeBytes=if($vhd){$vhd.Size}else{0}; FileSizeBytes=if($vhd){$vhd.FileSize}else{0} } }; ConvertTo-Json -InputObject $out -Depth 2`
  );
  const drives = parseJsonSafe(drivesResult.output).map(d => ({
    Path: d.Path,
    ControllerType: d.ControllerType,
    SizeGB: bytesToGB(d.SizeBytes),
    FileSizeGB: bytesToGB(d.FileSizeBytes),
  }));

  // NICs - single line
  const nicsResult = await runPS(
    `Get-VMNetworkAdapter -VMName "${name}" | Select-Object Name, SwitchName, IPAddresses, MacAddress, Status | ConvertTo-Json -Depth 3`
  );
  const nics = parseJsonSafe(nicsResult.output);

  vm.HardDrives = drives;
  vm.NetworkAdapters = nics;
  return vm;
}

async function startVM(vmName) {
  const name = sanitizeVMName(vmName);
  // Use runPSLong — Start-VM can block for 60–90s on VMs with large RAM allocations.
  // runPS has a 30s hardcoded timeout which causes silent failures on bigger VMs.
  const result = await runPSLong(`Start-VM -Name "${name}"`);
  if (!result.success) throw new Error(result.error);
  return true;
}

async function stopVM(vmName, force = false) {
  const name = sanitizeVMName(vmName);
  const flag = force ? '-Force' : '-TurnOff';
  const result = await runPS(`Stop-VM -Name "${name}" ${flag}`);
  if (!result.success) throw new Error(result.error);
  return true;
}

async function restartVM(vmName, force = false) {
  const name = sanitizeVMName(vmName);
  const flag = force ? '-Force' : '';
  // Use runPSLong — Restart-VM waits for the guest OS to shut down before rebooting,
  // which can exceed the 30s runPS timeout on a loaded VM.
  const result = await runPSLong(`Restart-VM -Name "${name}" ${flag}`);
  if (!result.success) throw new Error(result.error);
  return true;
}

async function suspendVM(vmName) {
  const name = sanitizeVMName(vmName);
  const result = await runPS(`Suspend-VM -Name "${name}"`);
  if (!result.success) throw new Error(result.error);
  return true;
}

async function resumeVM(vmName) {
  const name = sanitizeVMName(vmName);
  const result = await runPS(`Resume-VM -Name "${name}"`);
  if (!result.success) throw new Error(result.error);
  return true;
}

async function createSnapshot(vmName, snapshotName) {
  const name = sanitizeVMName(vmName);
  const snap = sanitizeSnapshotName(snapshotName);
  const result = await runPS(`Checkpoint-VM -Name "${name}" -SnapshotName "${snap}"`);
  if (!result.success) throw new Error(result.error);
  return true;
}

async function listSnapshots(vmName) {
  const name = sanitizeVMName(vmName);
  // Single line - pipe at end
  const result = await runPS(
    `Get-VMSnapshot -VMName "${name}" | Select-Object Name, SnapshotType, CreationTime, ParentSnapshotName, FileSize | ConvertTo-Json -Depth 3`
  );

  if (!result.success) throw new Error(result.error);
  return parseJsonSafe(result.output).map(s => ({
    ...s,
    SizeGB: bytesToGB(s.FileSize),
  }));
}

async function restoreSnapshot(vmName, snapshotName) {
  const name = sanitizeVMName(vmName);
  const snap = sanitizeSnapshotName(snapshotName);
  const result = await runPS(`Restore-VMSnapshot -VMName "${name}" -Name "${snap}" -Confirm:$false`);
  if (!result.success) throw new Error(result.error);
  return true;
}

async function deleteSnapshot(vmName, snapshotName) {
  const name = sanitizeVMName(vmName);
  const snap = sanitizeSnapshotName(snapshotName);
  const result = await runPS(`Remove-VMSnapshot -VMName "${name}" -Name "${snap}"`);
  if (!result.success) throw new Error(result.error);
  return true;
}

// Sanitize a Windows username (local account name)
function sanitizeWindowsUsername(username) {
  if (typeof username !== 'string') throw new Error('Username must be a string');
  // Windows local usernames: letters, digits, spaces, hyphens, underscores, dots — no quotes/backticks/$ etc.
  if (!/^[a-zA-Z0-9 _\-\.]+$/.test(username)) {
    throw new Error('Invalid username. Only alphanumeric characters, spaces, hyphens, underscores, and dots are allowed.');
  }
  if (username.length > 64) throw new Error('Username too long (max 64 characters)');
  return username.trim();
}

// Sanitize a password for safe embedding in a PowerShell string.
// We escape single-quotes and reject any characters that could break out of
// a ConvertTo-SecureString -String '...' call.
function sanitizeWindowsPassword(password) {
  if (typeof password !== 'string') throw new Error('Password must be a string');
  if (password.length < 6) throw new Error('Password must be at least 6 characters');
  if (password.length > 127) throw new Error('Password too long (max 127 characters)');
  // Reject backtick, null byte, and double-quote to prevent injection
  if (/[`\x00"]/.test(password)) {
    throw new Error('Password contains disallowed characters (backtick, null byte, or double-quote)');
  }
  // Escape single quotes for PowerShell single-quoted string
  return password.replace(/'/g, "''");
}

/**
 * Reset a local Windows account password inside a running VM using
 * Hyper-V's PowerShell Direct (Invoke-Command -VMName).
 *
 * Requirements:
 *  - VM must be running
 *  - Hyper-V Integration Services must be installed in the guest
 *  - The host must have credentials for a guest admin account
 *
 * @param {string} vmName        - Hyper-V VM name
 * @param {string} guestUser     - Guest admin username used to authenticate Invoke-Command
 * @param {string} guestPassword - Guest admin password for the above account
 * @param {string} targetUser    - Local account whose password should be changed
 * @param {string} newPassword   - New password to set
 */
async function resetVMPassword(vmName, guestUser, guestPassword, targetUser, newPassword) {
  const name       = sanitizeVMName(vmName);
  const tgtUser    = sanitizeWindowsUsername(targetUser);
  const safeGuest  = sanitizeWindowsUsername(guestUser);
  const safeGuestPw = sanitizeWindowsPassword(guestPassword);
  const safeNewPw  = sanitizeWindowsPassword(newPassword);

  // Build a PowerShell Direct command:
  //   1. Create a PSCredential from the guest admin account
  //   2. Use Invoke-Command -VMName to run Set-LocalUser inside the VM
  const script = [
    `$secGuest  = ConvertTo-SecureString '${safeGuestPw}' -AsPlainText -Force;`,
    `$cred      = New-Object System.Management.Automation.PSCredential ('${safeGuest}', $secGuest);`,
    `$secNew    = ConvertTo-SecureString '${safeNewPw}' -AsPlainText -Force;`,
    `Invoke-Command -VMName '${name}' -Credential $cred -ScriptBlock {`,
    `  param($u,$p)`,
    `  $acct = Get-LocalUser -Name $u -ErrorAction Stop;`,
    `  $acct | Set-LocalUser -Password $p;`,
    `} -ArgumentList '${tgtUser}', $secNew`,
  ].join(' ');

  const result = await runPS(script);
  if (!result.success) throw new Error(result.error);
  return true;
}

/**
 * Emergency offline password reset via VHD mount.
 *
 * Reliable approach that works on all Windows Server versions:
 *  1. Hard power-off the VM with Stop-VM -TurnOff
 *  2. Mount the VHD
 *  3. Find the Windows partition
 *  4. Write a SetupComplete.cmd into the VM — Windows Setup runs this as
 *     SYSTEM on first boot after any state change, giving us a guaranteed
 *     execution point that predates user login
 *  5. Dismount and optionally restart
 *
 * SetupComplete.cmd location: C:\Windows\Setup\Scripts\SetupComplete.cmd
 * Windows runs it automatically as SYSTEM on boot if it exists.
 * We write "net user <user> <pw>" + self-delete into it.
 */
async function emergencyResetVMPassword(vmName, targetUser, newPassword, restartAfter = true) {
  const name    = sanitizeVMName(vmName);
  const tgtUser = sanitizeWindowsUsername(targetUser);
  const safePw  = sanitizeWindowsPassword(newPassword);
  const restart = restartAfter === true || restartAfter === 'true' ? '$true' : '$false';

  const script = `
$ErrorActionPreference = 'Stop'
$vmName      = '${name}'
$targetUser  = '${tgtUser}'
$newPw       = '${safePw}'
$restartAfter = ${restart}
$vhdMounted  = $false

try {
  # 1. Get VM and hard power-off if not already Off
  $vm = Get-VM -Name $vmName -ErrorAction Stop
  Write-Output "INFO: VM state is: $($vm.State)"

  if ($vm.State -ne 'Off') {
    Write-Output "INFO: Attempting Stop-VM -TurnOff -Force..."
    try {
      Stop-VM -Name $vmName -TurnOff -Force -ErrorAction Stop
      Write-Output "INFO: Stop-VM command sent successfully"
    } catch {
      Write-Output "INFO: Stop-VM threw: $($_.Exception.Message)"
      Write-Output "INFO: Trying via WMI/CIM as fallback..."
      try {
        $vmWmi = Get-CimInstance -Namespace root/virtualization/v2 -ClassName Msvm_ComputerSystem -Filter "ElementName='$vmName'" -ErrorAction Stop
        $svc   = Get-CimInstance -Namespace root/virtualization/v2 -ClassName Msvm_VirtualSystemManagementService -ErrorAction Stop
        $result = Invoke-CimMethod -InputObject $svc -MethodName RequestStateChange -Arguments @{ RequestedState = [uint16]3; AffectedSystem = $vmWmi } -ErrorAction Stop
        Write-Output "INFO: WMI RequestStateChange returned: $($result.ReturnValue)"
      } catch {
        Write-Output "INFO: WMI fallback also failed: $($_.Exception.Message)"
        throw "Cannot stop VM '$vmName'. Stop-VM and WMI both failed. Please stop the VM manually first."
      }
    }
    Write-Output "INFO: Waiting up to 90s for VM to reach Off state..."
    $deadline = (Get-Date).AddSeconds(90)
    do {
      Start-Sleep -Seconds 2
      $vm = Get-VM -Name $vmName
      Write-Output "INFO: VM state: $($vm.State)"
    } while ($vm.State -ne 'Off' -and (Get-Date) -lt $deadline)
    if ($vm.State -ne 'Off') {
      throw "VM '$vmName' did not reach Off state within 90s. Final state: $($vm.State). Please stop it manually."
    }
  }
  Write-Output "INFO: VM is Off."

  # 2. Find VHD
  $vhdPath = (Get-VMHardDiskDrive -VMName $vmName -ErrorAction Stop | Select-Object -First 1).Path
  if (-not $vhdPath) { throw "No VHD attached to VM '$vmName'" }
  Write-Output "INFO: VHD path: $vhdPath"

  # 3. Mount VHD
  Write-Output "INFO: Mounting VHD..."
  Mount-VHD -Path $vhdPath -NoDriveLetter -ErrorAction Stop
  $vhdMounted = $true

  # 4. Find the Windows partition (has \Windows\Setup or \Windows\System32)
  $disk = Get-VHD -Path $vhdPath -ErrorAction Stop | Get-Disk -ErrorAction Stop
  Write-Output "INFO: VHD mounted as disk $($disk.Number)"

  $winLetter = $null
  $winPartNum = $null
  foreach ($part in (Get-Partition -DiskNumber $disk.Number -ErrorAction SilentlyContinue)) {
    Add-PartitionAccessPath -DiskNumber $disk.Number -PartitionNumber $part.PartitionNumber -AssignDriveLetter -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
    $p = Get-Partition -DiskNumber $disk.Number -PartitionNumber $part.PartitionNumber -ErrorAction SilentlyContinue
    if ($p -and $p.DriveLetter) {
      $letter = $p.DriveLetter
      Write-Output "INFO: Checking partition $($part.PartitionNumber) at drive $letter..."
      if (Test-Path "$($letter):\Windows\System32\config\SAM") {
        Write-Output "INFO: Found Windows partition at $letter:"
        $winLetter  = $letter
        $winPartNum = $part.PartitionNumber
        break
      } else {
        Remove-PartitionAccessPath -DiskNumber $disk.Number -PartitionNumber $part.PartitionNumber -AccessPath "$($letter):\" -ErrorAction SilentlyContinue
      }
    }
  }

  if (-not $winLetter) { throw "Could not find Windows partition on VHD" }

  # 5. Write SetupComplete.cmd — Windows runs this as SYSTEM on next boot
  $setupDir = "$($winLetter):\Windows\Setup\Scripts"
  if (-not (Test-Path $setupDir)) {
    New-Item -ItemType Directory -Path $setupDir -Force | Out-Null
  }

  $cmdPath = "$setupDir\SetupComplete.cmd"
  Write-Output "INFO: Writing SetupComplete.cmd to $cmdPath"

  # The script: reset password, then delete itself so it doesn't repeat
  # Build cmd file content without PowerShell backtick escapes (safe inside JS template literal)
  $crlf = [char]13 + [char]10
  $cmdContent = "@echo off" + $crlf
  $cmdContent += "net user " + $targetUser + " " + $newPw + $crlf
  $cmdContent += "del /f /q " + [char]34 + "%~f0" + [char]34 + $crlf
  [System.IO.File]::WriteAllText($cmdPath, $cmdContent, [System.Text.Encoding]::ASCII)
  Write-Output "INFO: SetupComplete.cmd written successfully."

  # 6. Clean up drive letter and dismount
  Remove-PartitionAccessPath -DiskNumber $disk.Number -PartitionNumber $winPartNum -AccessPath "$($winLetter):\" -ErrorAction SilentlyContinue
  Dismount-VHD -Path $vhdPath -ErrorAction SilentlyContinue
  $vhdMounted = $false
  Write-Output "INFO: VHD dismounted."

  # 7. Optionally restart
  if ($restartAfter) {
    Write-Output "INFO: Starting VM..."
    Start-VM -Name $vmName -ErrorAction Stop
    Write-Output "INFO: VM started."
  }

  Write-Output "SUCCESS: SetupComplete.cmd injected. Password for '$targetUser' will be reset on next VM boot."

} catch {
  Write-Output "ERROR: $($_.Exception.Message)"
  if ($vhdMounted) {
    try {
      $disk2 = Get-VHD -Path $vhdPath -ErrorAction SilentlyContinue | Get-Disk -ErrorAction SilentlyContinue
      if ($disk2) {
        foreach ($p2 in (Get-Partition -DiskNumber $disk2.Number -ErrorAction SilentlyContinue)) {
          if ($p2.DriveLetter) {
            Remove-PartitionAccessPath -DiskNumber $disk2.Number -PartitionNumber $p2.PartitionNumber -AccessPath "$($p2.DriveLetter):\" -ErrorAction SilentlyContinue
          }
        }
      }
      Dismount-VHD -Path $vhdPath -ErrorAction SilentlyContinue
    } catch {}
  }
  throw $_
}
`.trim().replace(/\r\n/g, '\n');

  const result = await runPSLong(script);
  if (!result.success) throw new Error(result.error);
  // Surface all INFO lines + the final SUCCESS/ERROR line
  return result.output;
}

async function getVMGuid(vmName) {
  const name = sanitizeVMName(vmName);
  const result = await runPS(`Get-VM -Name "${name}" -ErrorAction Stop | Select-Object -ExpandProperty Id`);
  if (!result.success) throw new Error(result.error);
  const guid = (result.output || '').trim().replace(/[{}\r\n]/g, '');
  if (!guid) throw new Error(`Could not get GUID for VM "${name}"`);
  return guid;
}

module.exports = {
  listVMs,
  listSpecificVMs,
  getVMDetails,
  startVM,
  stopVM,
  restartVM,
  suspendVM,
  resumeVM,
  createSnapshot,
  listSnapshots,
  restoreSnapshot,
  deleteSnapshot,
  resetVMPassword,
  emergencyResetVMPassword,
  listSwitches,
  createVM,
  deleteVM,
  listISOs,
  attachISO,
  detachISO,
  getVMDvdDrive,
  getNetworkMetrics,
  sanitizeVMName,
  getVMGuid,
};

// ─── VM Creation ─────────────────────────────────────────────────────────────

function sanitizePath(p) {
  if (typeof p !== 'string') throw new Error('Path must be a string');
  // Allow drive letters, colons, backslashes, alphanumeric, spaces, hyphens, underscores, dots, brackets
  if (!/^[a-zA-Z]:[\\\/][a-zA-Z0-9 _\-\\.\\\/\[\]()]+$/.test(p)) {
    throw new Error(`Invalid path: "${p}"`);
  }
  if (p.length > 260) throw new Error('Path too long');
  return p.trim();
}

function sanitizeSwitch(name) {
  if (typeof name !== 'string') throw new Error('Switch name must be a string');
  if (!/^[a-zA-Z0-9 _\-\.()]+$/.test(name)) throw new Error('Invalid switch name');
  if (name.length > 100) throw new Error('Switch name too long');
  return name.trim();
}

async function listSwitches() {
  const result = await runPS(
    `Get-VMSwitch | Select-Object Name, SwitchType, AllowManagementOS | ConvertTo-Json -Depth 2`
  );
  if (!result.success) throw new Error(result.error);
  return parseJsonSafe(result.output);
}

async function createVM(opts) {
  const name       = sanitizeVMName(opts.name);
  const ramBytes   = Math.max(512, Math.min(131072, parseInt(opts.ramMB) || 2048)) * 1024 * 1024;
  const cpuCount   = Math.max(1, Math.min(64, parseInt(opts.cpuCount) || 2));
  const diskGB     = Math.max(1, Math.min(65536, parseInt(opts.diskGB) || 50));
  const generation = [1, 2].includes(parseInt(opts.generation)) ? parseInt(opts.generation) : 2;
  const vhdPath    = sanitizePath(opts.vhdPath);
  const isoPath    = opts.isoPath ? sanitizePath(opts.isoPath) : null;
  const switchName = opts.switchName ? sanitizeSwitch(opts.switchName) : null;

  const lines = [
    // Create VM
    `$vm = New-VM -Name '${name}' -Generation ${generation} -MemoryStartupBytes ${ramBytes} -NoVHD -ErrorAction Stop;`,
    // CPU
    `Set-VMProcessor -VMName '${name}' -Count ${cpuCount};`,
    // Disable dynamic memory, set static RAM
    `Set-VMMemory -VMName '${name}' -DynamicMemoryEnabled $false -StartupBytes ${ramBytes};`,
    // Create and attach VHD
    `New-VHD -Path '${vhdPath}' -SizeBytes ${diskGB * 1024 * 1024 * 1024} -Dynamic -ErrorAction Stop | Out-Null;`,
    `Add-VMHardDiskDrive -VMName '${name}' -Path '${vhdPath}';`,
  ];

  if (isoPath) {
    if (generation === 1) {
      lines.push(`Set-VMDvdDrive -VMName '${name}' -Path '${isoPath}';`);
    } else {
      lines.push(`Add-VMDvdDrive -VMName '${name}' -Path '${isoPath}';`);
    }
    // Set boot order for Gen2 to boot from DVD first
    if (generation === 2) {
      lines.push(
        `$dvd = Get-VMDvdDrive -VMName '${name}';`,
        `$hd  = Get-VMHardDiskDrive -VMName '${name}';`,
        `Set-VMFirmware -VMName '${name}' -BootOrder $dvd,$hd;`
      );
    }
  }

  if (switchName) {
    lines.push(`Connect-VMNetworkAdapter -VMName '${name}' -SwitchName '${switchName}';`);
  }

  const result = await runPS(lines.join(' '));
  if (!result.success) throw new Error(result.error);
  return true;
}

async function deleteVM(vmName, deleteFiles = false) {
  const name = sanitizeVMName(vmName);
  let script = `Stop-VM -Name '${name}' -TurnOff -Force -ErrorAction SilentlyContinue; `;
  if (deleteFiles) {
    script += `$vhds = Get-VMHardDiskDrive -VMName '${name}' | Select-Object -ExpandProperty Path; `;
  }
  script += `Remove-VM -Name '${name}' -Force -ErrorAction Stop; `;
  if (deleteFiles) {
    script += `$vhds | ForEach-Object { if (Test-Path $_) { Remove-Item $_ -Force -ErrorAction SilentlyContinue } };`;
  }
  const result = await runPS(script);
  if (!result.success) throw new Error(result.error);
  return true;
}

// ─── ISO Library ─────────────────────────────────────────────────────────────

async function listISOs(isoFolder) {
  const folder = sanitizePath(isoFolder);
  const result = await runPS(
    `if (Test-Path '${folder}') { Get-ChildItem -Path '${folder}' -Filter *.iso -Recurse | Select-Object Name, FullName, @{N='SizeBytes';E={$_.Length}}, LastWriteTime | ConvertTo-Json -Depth 2 } else { '[]' }`
  );
  if (!result.success) throw new Error(result.error);
  return parseJsonSafe(result.output);
}

async function attachISO(vmName, isoPath) {
  const name = sanitizeVMName(vmName);
  const iso  = sanitizePath(isoPath);
  const result = await runPS(
    `$dvd = Get-VMDvdDrive -VMName '${name}' | Select-Object -First 1; if ($dvd) { Set-VMDvdDrive -VMName '${name}' -Path '${iso}' } else { Add-VMDvdDrive -VMName '${name}' -Path '${iso}' }`
  );
  if (!result.success) throw new Error(result.error);
  return true;
}

async function detachISO(vmName) {
  const name = sanitizeVMName(vmName);
  const result = await runPS(
    `Get-VMDvdDrive -VMName '${name}' | Set-VMDvdDrive -Path $null`
  );
  if (!result.success) throw new Error(result.error);
  return true;
}

async function getVMDvdDrive(vmName) {
  const name = sanitizeVMName(vmName);
  const result = await runPS(
    `Get-VMDvdDrive -VMName '${name}' | Select-Object Path, ControllerType | ConvertTo-Json -Depth 2`
  );
  if (!result.success) return [];
  return parseJsonSafe(result.output);
}

// ─── Bandwidth / Network metrics ─────────────────────────────────────────────

async function getNetworkMetrics(vmName) {
  const name = sanitizeVMName(vmName);
  const result = await runPS(
    `$adapters = Get-VMNetworkAdapter -VMName '${name}'; $out = @(); foreach ($a in $adapters) { $out += [PSCustomObject]@{ AdapterName=$a.Name; BytesReceived=$a.BandwidthSetting.DefaultFlowMinimumBandwidthAbsolute; MbpsReceived=0; MbpsSent=0 } }; Get-VMNetworkAdapterExtendedAcl -VMName '${name}' -ErrorAction SilentlyContinue | Out-Null; $counters = Get-Counter -Counter "\\Hyper-V Virtual Network Adapter(*)*" -ErrorAction SilentlyContinue; if ($counters) { $out | ConvertTo-Json -Depth 2 } else { $adapters | Select-Object Name, @{N='MacAddress';E={$_.MacAddress}}, @{N='IPAddresses';E={$_.IPAddresses -join ','}}, @{N='Connected';E={$_.Connected}} | ConvertTo-Json -Depth 2 }`
  );
  // Fallback — use simpler perf counter approach
  const result2 = await runPS(
    `$vm = '${name}'; $adapters = Get-VMNetworkAdapter -VMName $vm -ErrorAction SilentlyContinue; if (-not $adapters) { Write-Output '[]'; return }; $out = @(); foreach ($a in $adapters) { $out += [PSCustomObject]@{ Name=$a.Name; MacAddress=$a.MacAddress; SwitchName=$a.SwitchName; Connected=$a.Connected; IPAddresses=($a.IPAddresses -join ',') } }; ConvertTo-Json -InputObject $out -Depth 2`
  );
  if (!result2.success) return [];
  return parseJsonSafe(result2.output);
}

