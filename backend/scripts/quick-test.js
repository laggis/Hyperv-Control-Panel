/**
 * Quick DDoS Detection Test
 * 
 * This is a simple 30-second test to verify the system works.
 * Run this after starting your backend server.
 */

require('dotenv').config();
const db = require('../utils/database');

const TEST_VM = 'QUICK-TEST-VM';

async function quickTest() {
  console.log('\n🚀 Quick DDoS Detection Test (30 seconds)\n');
  console.log('━'.repeat(60));
  
  try {
    // Step 1: Verify database
    console.log('\n1️⃣  Checking database tables...');
    const ddosTable = await db.get(
      "SELECT COUNT(*) as c FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'ddos_events'"
    );
    
    if (ddosTable.c === 1) {
      console.log('   ✅ ddos_events table exists');
    } else {
      console.log('   ❌ ddos_events table missing!');
      console.log('   Run: npm run migrate or restart your backend');
      process.exit(1);
    }
    
    // Step 2: Clean up any old test data
    console.log('\n2️⃣  Cleaning up old test data...');
    await db.run('DELETE FROM bandwidth_history WHERE vm_name = ?', [TEST_VM]);
    await db.run('DELETE FROM ddos_events WHERE vm_name = ?', [TEST_VM]);
    console.log('   ✅ Clean');
    
    // Step 3: Check if detection is enabled
    console.log('\n3️⃣  Checking detection status...');
    const enabled = await db.get("SELECT value FROM settings WHERE `key` = 'ddos_detection_enabled'");
    if (enabled && enabled.value === '1') {
      console.log('   ✅ DDoS detection is ENABLED');
    } else {
      console.log('   ⚠️  DDoS detection is DISABLED');
      console.log('   Enable it in the DDoS Protection page');
    }
    
    // Step 4: Create fake baseline (5 MB/s normal traffic)
    console.log('\n4️⃣  Creating fake baseline data...');
    const normalBytes = 5 * 1024 * 1024 * 60; // 5 MB/s * 60 seconds
    for (let i = 10; i > 0; i--) {
      await db.run(
        `INSERT INTO bandwidth_history (vm_name, bytes_in, bytes_out, recorded_at) 
         VALUES (?, 50000, ?, NOW() - INTERVAL ${i} MINUTE)`,
        [TEST_VM, normalBytes]
      );
    }
    console.log('   ✅ Created 10 samples of normal traffic (~5 MB/s)');
    
    // Step 5: Create spike
    console.log('\n5️⃣  Injecting bandwidth spike (100 MB/s)...');
    const spikeBytes = 100 * 1024 * 1024 * 60; // 100 MB/s * 60 seconds
    await db.run(
      `INSERT INTO bandwidth_history (vm_name, bytes_in, bytes_out, recorded_at) 
       VALUES (?, 50000, ?, NOW())`,
      [TEST_VM, spikeBytes]
    );
    console.log('   ✅ Spike injected');
    
    // Step 6: Run detection
    console.log('\n6️⃣  Running detection...');
    const ddos = require('../utils/ddosDetector');
    const result = await ddos.detectDDoS(TEST_VM, null);
    
    if (result.detected) {
      console.log('   ✅ DETECTION SUCCESSFUL!');
      console.log(`   📊 Type: ${result.type}`);
      console.log(`   ⚠️  Severity: ${result.severity}`);
      console.log(`   📈 Details: ${result.details}`);
      
      // Check database
      const event = await db.get(
        'SELECT * FROM ddos_events WHERE vm_name = ? ORDER BY created_at DESC LIMIT 1',
        [TEST_VM]
      );
      
      if (event) {
        console.log('   ✅ Event saved to database (ID: ' + event.id + ')');
      }
    } else {
      console.log('   ❌ Detection failed');
      console.log('   Reason:', result.reason || 'unknown');
      console.log('   This might be due to cooldown or disabled detection');
    }
    
    // Step 7: Check notifications
    console.log('\n7️⃣  Notification settings:');
    const email = await db.get("SELECT value FROM settings WHERE `key` = 'ddos_alert_email'");
    const webhook = await db.get("SELECT value FROM settings WHERE `key` = 'ddos_alert_webhook'");
    
    if (email && email.value) {
      console.log(`   📧 Email: ${email.value}`);
    } else {
      console.log('   ⚠️  No alert email configured');
    }
    
    if (webhook && webhook.value) {
      console.log(`   🔔 Webhook: ${webhook.value.substring(0, 40)}...`);
    } else {
      console.log('   ⚠️  No alert webhook configured');
    }
    
    if ((!email || !email.value) && (!webhook || !webhook.value)) {
      console.log('   💡 Tip: Configure email/webhook in DDoS Protection page');
    }
    
    // Summary
    console.log('\n━'.repeat(60));
    console.log('\n✅ Quick test complete!');
    console.log('\nWhat to do next:');
    console.log('  1. Go to DDoS Protection page in the web UI');
    console.log('  2. You should see the test event');
    console.log('  3. Configure email/webhook for real alerts');
    console.log('  4. Run full tests: node scripts/test-ddos-detection.js all');
    console.log('\nCleanup test data:');
    console.log('  node scripts/test-ddos-detection.js cleanup');
    console.log('');
    
  } catch (err) {
    console.error('\n❌ Test failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

// Run test
(async () => {
  try {
    await db.init();
    await quickTest();
    process.exit(0);
  } catch (err) {
    console.error('Fatal error:', err);
    process.exit(1);
  }
})();
