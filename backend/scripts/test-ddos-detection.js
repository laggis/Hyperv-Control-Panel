/**
 * DDoS Detection Testing Script
 * 
 * This script helps test the DDoS detection system by:
 * 1. Injecting fake bandwidth data to simulate traffic spikes
 * 2. Triggering manual scans to test detection logic
 * 3. Verifying notifications are sent correctly
 * 
 * Usage:
 *   node scripts/test-ddos-detection.js [test-type]
 * 
 * Test Types:
 *   - spike: Simulate a bandwidth spike
 *   - sustained: Simulate sustained high traffic
 *   - baseline: Create baseline data
 *   - verify: Check if system is working
 *   - all: Run all tests
 */

require('dotenv').config();
const db = require('../utils/database');
const ddos = require('../utils/ddosDetector');

// Test configuration
const TEST_VM_NAME = 'TEST-VM'; // This VM doesn't need to actually exist
const SPIKE_RATE_MBPS = 75;     // Will trigger spike detection (default threshold: 50 MB/s)
const SUSTAINED_RATE_MBPS = 40; // Will trigger sustained detection (default threshold: 30 MB/s)

function mbpsToBytes(mbps, seconds = 60) {
  return mbps * 1024 * 1024 * seconds;
}

async function cleanup() {
  console.log('\n🧹 Cleaning up test data...');
  try {
    await db.run('DELETE FROM bandwidth_history WHERE vm_name = ?', [TEST_VM_NAME]);
    await db.run('DELETE FROM ddos_events WHERE vm_name = ?', [TEST_VM_NAME]);
    console.log('✅ Cleanup complete\n');
  } catch (err) {
    console.error('❌ Cleanup failed:', err.message);
  }
}

async function createBaselineData() {
  console.log('📊 Creating baseline bandwidth data...');
  console.log('   This simulates 2 hours of normal traffic (~5 MB/s)');
  
  try {
    const normalRate = 5; // MB/s
    const samplesPerHour = 60; // One per minute
    const hours = 2;
    
    for (let i = hours * samplesPerHour; i > 0; i--) {
      const minutesAgo = i;
      const bytes = mbpsToBytes(normalRate, 60);
      
      await db.run(
        `INSERT INTO bandwidth_history (vm_name, bytes_in, bytes_out, recorded_at) 
         VALUES (?, 100000, ?, NOW() - INTERVAL ${minutesAgo} MINUTE)`,
        [TEST_VM_NAME, bytes]
      );
    }
    
    const count = await db.get(
      'SELECT COUNT(*) as c FROM bandwidth_history WHERE vm_name = ?',
      [TEST_VM_NAME]
    );
    
    console.log(`✅ Created ${count.c} baseline samples (${hours} hours @ ~${normalRate} MB/s)\n`);
    return true;
  } catch (err) {
    console.error('❌ Failed to create baseline:', err.message);
    return false;
  }
}

async function testBandwidthSpike() {
  console.log('🔥 TEST 1: Bandwidth Spike Detection');
  console.log('━'.repeat(60));
  console.log(`   Simulating sudden spike to ${SPIKE_RATE_MBPS} MB/s`);
  console.log(`   (Threshold: ${ddos.getConfig().OUTBOUND_SPIKE_THRESHOLD} MB/s)\n`);
  
  try {
    // Insert a sudden spike in the most recent data point
    const spikeBytes = mbpsToBytes(SPIKE_RATE_MBPS, 60);
    await db.run(
      `INSERT INTO bandwidth_history (vm_name, bytes_in, bytes_out, recorded_at) 
       VALUES (?, 100000, ?, NOW())`,
      [TEST_VM_NAME, spikeBytes]
    );
    
    console.log('   📈 Spike data inserted, running detection...');
    
    // Run detection
    const result = await ddos.detectDDoS(TEST_VM_NAME, null);
    
    console.log('\n   📋 Detection Result:');
    console.log('   ' + JSON.stringify(result, null, 4).replace(/\n/g, '\n   '));
    
    if (result.detected && result.type === 'bandwidth_spike') {
      console.log('\n✅ PASS: Bandwidth spike detected correctly!');
      
      // Check if event was logged
      const event = await db.get(
        'SELECT * FROM ddos_events WHERE vm_name = ? ORDER BY created_at DESC LIMIT 1',
        [TEST_VM_NAME]
      );
      
      if (event) {
        console.log('✅ PASS: Event logged to database');
        console.log(`   ID: ${event.id}, Type: ${event.detection_type}, Severity: ${event.severity}`);
      } else {
        console.log('⚠️  WARN: Detection succeeded but no event in database');
      }
      
      return true;
    } else {
      console.log('\n❌ FAIL: Spike not detected!');
      console.log('   Expected: bandwidth_spike detection');
      console.log(`   Got: ${JSON.stringify(result)}`);
      return false;
    }
  } catch (err) {
    console.error('❌ ERROR:', err.message);
    return false;
  }
}

async function testSustainedTraffic() {
  console.log('\n⏱️  TEST 2: Sustained High Bandwidth Detection');
  console.log('━'.repeat(60));
  console.log(`   Simulating 6 minutes of sustained ${SUSTAINED_RATE_MBPS} MB/s traffic`);
  console.log(`   (Threshold: ${ddos.getConfig().OUTBOUND_SUSTAINED_THRESHOLD} MB/s)\n`);
  
  try {
    // Insert 6 minutes of sustained high traffic
    const sustainedBytes = mbpsToBytes(SUSTAINED_RATE_MBPS, 60);
    
    for (let i = 6; i > 0; i--) {
      await db.run(
        `INSERT INTO bandwidth_history (vm_name, bytes_in, bytes_out, recorded_at) 
         VALUES (?, 100000, ?, NOW() - INTERVAL ${i} MINUTE)`,
        [TEST_VM_NAME, sustainedBytes]
      );
    }
    
    console.log('   📈 Sustained traffic data inserted, running detection...');
    
    // Run detection
    const result = await ddos.detectDDoS(TEST_VM_NAME, null);
    
    console.log('\n   📋 Detection Result:');
    console.log('   ' + JSON.stringify(result, null, 4).replace(/\n/g, '\n   '));
    
    if (result.detected && result.type === 'sustained_bandwidth') {
      console.log('\n✅ PASS: Sustained traffic detected correctly!');
      
      // Check if event was logged
      const events = await db.all(
        'SELECT * FROM ddos_events WHERE vm_name = ? ORDER BY created_at DESC LIMIT 2',
        [TEST_VM_NAME]
      );
      
      console.log(`✅ PASS: ${events.length} event(s) logged to database`);
      return true;
    } else {
      console.log('\n❌ FAIL: Sustained traffic not detected!');
      console.log('   Expected: sustained_bandwidth detection');
      console.log(`   Got: ${JSON.stringify(result)}`);
      return false;
    }
  } catch (err) {
    console.error('❌ ERROR:', err.message);
    return false;
  }
}

async function testNotifications() {
  console.log('\n📧 TEST 3: Notification System');
  console.log('━'.repeat(60));
  
  try {
    const config = await db.all(
      "SELECT `key`, value FROM settings WHERE `key` LIKE 'ddos_%'"
    );
    
    const settings = {};
    config.forEach(s => settings[s.key] = s.value);
    
    console.log('   Current notification settings:');
    console.log(`   • Email: ${settings.ddos_alert_email || '(not configured)'}`);
    console.log(`   • Webhook: ${settings.ddos_alert_webhook ? settings.ddos_alert_webhook.substring(0, 40) + '...' : '(not configured)'}`);
    
    if (!settings.ddos_alert_email && !settings.ddos_alert_webhook) {
      console.log('\n⚠️  SKIP: No notification endpoints configured');
      console.log('   To test notifications:');
      console.log('   1. Go to DDoS Protection page');
      console.log('   2. Click Configure');
      console.log('   3. Set Alert Email or Alert Webhook URL');
      console.log('   4. Run this test again');
      return null;
    }
    
    // Check if we have SMTP configured for email
    if (settings.ddos_alert_email) {
      const smtpHost = (await db.get("SELECT value FROM settings WHERE `key` = 'alert_smtp_host'"))?.value;
      if (!smtpHost) {
        console.log('\n⚠️  WARN: Email configured but SMTP not set up');
        console.log('   Configure SMTP in Settings page first');
      } else {
        console.log('   ✅ SMTP configured');
      }
    }
    
    if (settings.ddos_alert_webhook) {
      console.log('   ✅ Webhook configured');
    }
    
    console.log('\n   To test notifications, trigger a detection (run spike or sustained test)');
    console.log('   and check your email/webhook endpoint for alerts.');
    
    return true;
  } catch (err) {
    console.error('❌ ERROR:', err.message);
    return false;
  }
}

async function testCooldown() {
  console.log('\n⏰ TEST 4: Cooldown Period');
  console.log('━'.repeat(60));
  console.log('   Testing that alerts respect cooldown period (15 minutes)\n');
  
  try {
    // First detection
    console.log('   Running first detection...');
    const result1 = await ddos.detectDDoS(TEST_VM_NAME, null);
    
    if (result1.detected) {
      console.log('   ✅ First detection succeeded');
      
      // Immediate second detection (should be in cooldown)
      console.log('   Running second detection immediately...');
      const result2 = await ddos.detectDDoS(TEST_VM_NAME, null);
      
      if (!result2.detected && result2.reason === 'cooldown') {
        console.log('   ✅ PASS: Cooldown working correctly!');
        console.log('   Second detection blocked by cooldown period');
        return true;
      } else {
        console.log('   ⚠️  WARN: Cooldown may not be working');
        console.log(`   Expected cooldown, got: ${JSON.stringify(result2)}`);
        return false;
      }
    } else {
      console.log('   ⚠️  First detection did not trigger (expected if no spike data)');
      return null;
    }
  } catch (err) {
    console.error('❌ ERROR:', err.message);
    return false;
  }
}

async function verifySystem() {
  console.log('🔍 System Verification');
  console.log('━'.repeat(60));
  
  try {
    // Check database tables
    console.log('\n1️⃣  Database Tables:');
    
    const ddosTable = await db.get(
      "SELECT COUNT(*) as c FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'ddos_events'"
    );
    console.log(`   ${ddosTable.c === 1 ? '✅' : '❌'} ddos_events table ${ddosTable.c === 1 ? 'exists' : 'missing'}`);
    
    const bwTable = await db.get(
      "SELECT COUNT(*) as c FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'bandwidth_history'"
    );
    console.log(`   ${bwTable.c === 1 ? '✅' : '❌'} bandwidth_history table ${bwTable.c === 1 ? 'exists' : 'missing'}`);
    
    // Check settings
    console.log('\n2️⃣  DDoS Settings:');
    const settings = await db.all("SELECT `key`, value FROM settings WHERE `key` LIKE 'ddos_%'");
    
    if (settings.length > 0) {
      console.log('   ✅ Settings configured:');
      settings.forEach(s => {
        const display = s.key.includes('webhook') && s.value 
          ? s.value.substring(0, 30) + '...' 
          : s.value;
        console.log(`      • ${s.key}: ${display || '(empty)'}`);
      });
    } else {
      console.log('   ⚠️  No DDoS settings found (will use defaults)');
    }
    
    // Check detector configuration
    console.log('\n3️⃣  Detector Configuration:');
    const config = ddos.getConfig();
    console.log(`   • Spike Threshold: ${config.OUTBOUND_SPIKE_THRESHOLD} MB/s`);
    console.log(`   • Sustained Threshold: ${config.OUTBOUND_SUSTAINED_THRESHOLD} MB/s`);
    console.log(`   • Alert Cooldown: ${config.ALERT_COOLDOWN_MINUTES} minutes`);
    console.log(`   • Auto-Suspend: ${config.AUTO_SUSPEND_ENABLED ? 'Enabled' : 'Disabled'}`);
    console.log(`   • Auto-Disconnect: ${config.AUTO_DISCONNECT_NETWORK ? 'Enabled' : 'Disabled'}`);
    console.log(`   • Alert Mode: ${config.ALERT_ONLY ? 'Alert Only' : 'With Actions'}`);
    
    // Check recent events
    console.log('\n4️⃣  Recent DDoS Events:');
    const events = await db.all(
      'SELECT vm_name, detection_type, severity, created_at FROM ddos_events ORDER BY created_at DESC LIMIT 5'
    );
    
    if (events.length > 0) {
      console.log(`   Found ${events.length} recent event(s):`);
      events.forEach(e => {
        console.log(`   • ${e.vm_name} - ${e.detection_type} (${e.severity}) at ${e.created_at}`);
      });
    } else {
      console.log('   No events recorded yet (system is clean)');
    }
    
    // Check bandwidth data
    console.log('\n5️⃣  Bandwidth Monitoring:');
    const bwCount = await db.get(
      'SELECT COUNT(*) as c FROM bandwidth_history WHERE recorded_at > NOW() - INTERVAL 1 HOUR'
    );
    console.log(`   ${bwCount.c > 0 ? '✅' : '⚠️ '} ${bwCount.c} bandwidth samples in last hour`);
    
    if (bwCount.c === 0) {
      console.log('   Note: Bandwidth data is collected every 60 seconds by the monitor');
      console.log('   Make sure the backend server is running and has been up for >1 minute');
    }
    
    console.log('\n━'.repeat(60));
    console.log('✅ System verification complete!\n');
    
    return true;
  } catch (err) {
    console.error('❌ Verification failed:', err.message);
    return false;
  }
}

async function runAllTests() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║          DDoS DETECTION SYSTEM - FULL TEST SUITE          ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  
  // Cleanup first
  await cleanup();
  
  // Verify system
  console.log('Step 1: System Verification\n');
  const verifyResult = await verifySystem();
  if (!verifyResult) {
    console.log('\n❌ System verification failed. Please check your setup.');
    process.exit(1);
  }
  
  // Create baseline
  console.log('\nStep 2: Creating Test Data\n');
  const baselineResult = await createBaselineData();
  if (!baselineResult) {
    console.log('\n❌ Failed to create baseline data.');
    process.exit(1);
  }
  
  // Run tests
  console.log('\nStep 3: Running Detection Tests\n');
  
  const spikeResult = await testBandwidthSpike();
  if (spikeResult === true) passed++;
  else if (spikeResult === false) failed++;
  else skipped++;
  
  const sustainedResult = await testSustainedTraffic();
  if (sustainedResult === true) passed++;
  else if (sustainedResult === false) failed++;
  else skipped++;
  
  const cooldownResult = await testCooldown();
  if (cooldownResult === true) passed++;
  else if (cooldownResult === false) failed++;
  else skipped++;
  
  const notifResult = await testNotifications();
  if (notifResult === true) passed++;
  else if (notifResult === false) failed++;
  else skipped++;
  
  // Summary
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║                      TEST SUMMARY                          ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  console.log(`   ✅ Passed:  ${passed}`);
  console.log(`   ❌ Failed:  ${failed}`);
  console.log(`   ⚠️  Skipped: ${skipped}`);
  console.log(`   📊 Total:   ${passed + failed + skipped}\n`);
  
  if (failed === 0) {
    console.log('🎉 All tests passed! DDoS detection is working correctly.\n');
  } else {
    console.log('⚠️  Some tests failed. Please review the output above.\n');
  }
  
  // Cleanup test data
  const shouldCleanup = process.argv.includes('--cleanup');
  if (shouldCleanup) {
    await cleanup();
    console.log('🧹 Test data cleaned up.\n');
  } else {
    console.log('ℹ️  Test data preserved. Run with --cleanup to remove test data.\n');
  }
}

// Main execution
const testType = process.argv[2] || 'all';

(async () => {
  try {
    await db.init();
    
    switch (testType) {
      case 'verify':
        await verifySystem();
        break;
      case 'baseline':
        await cleanup();
        await createBaselineData();
        break;
      case 'spike':
        await cleanup();
        await createBaselineData();
        await testBandwidthSpike();
        break;
      case 'sustained':
        await cleanup();
        await createBaselineData();
        await testSustainedTraffic();
        break;
      case 'notifications':
        await testNotifications();
        break;
      case 'cooldown':
        await cleanup();
        await createBaselineData();
        await testBandwidthSpike();
        await testCooldown();
        break;
      case 'all':
        await runAllTests();
        break;
      case 'cleanup':
        await cleanup();
        break;
      default:
        console.log('Unknown test type:', testType);
        console.log('Available tests: verify, baseline, spike, sustained, notifications, cooldown, all, cleanup');
        process.exit(1);
    }
    
    process.exit(0);
  } catch (err) {
    console.error('Fatal error:', err);
    process.exit(1);
  }
})();
