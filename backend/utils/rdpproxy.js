/**
 * Hyper-V Console WebSocket Proxy
 *
 * How Hyper-V console access works:
 *   - Every Hyper-V VM exposes its console via RDP on the HOST at port 2179
 *   - Instead of a standard RDP connection, you pass a "preconnection blob" (PCB)
 *     which is the VM's GUID — Hyper-V uses this to route to the right VM
 *   - This works with NO software in the VM, NO VM network, even mid-boot
 *   - The host itself must have port 2179 open (it always is for Hyper-V)
 *
 * This legacy proxy:
 *   1. Accepts a WebSocket from the browser (authenticated via JWT)
 *   2. Opens a TCP connection to localhost:2179
 *   3. Sends the RDP Preconnection PDU (with the VM GUID) as the very first bytes
 *   4. Then acts as a transparent binary pipe — WebSocket <-> Hyper-V
 *
 * The built-in panel console uses rdpConsole.js (node-rdpjs + canvas) instead.
 * This endpoint remains for optional raw RDP tunnel clients.
 *
 * RDP Preconnection PDU format (MS-RDPPCB spec):
 *   - 4 bytes: cbSize (little-endian uint32) = total PDU size
 *   - 4 bytes: dwFlags = 1 (version 1) or 2 (version 2 with blob)
 *   - 4 bytes: cchPCB = character count of the PCB string (including null)
 *   - variable: PCB string as UTF-16LE (the VM GUID string)
 */

const WebSocket = require('ws');
const net       = require('net');
const jwt       = require('jsonwebtoken');
const url       = require('url');
const db        = require('./database');

const JWT_SECRET    = process.env.JWT_SECRET || 'fallback-secret';
const HYPERV_PORT   = 2179;
const HYPERV_HOST   = '127.0.0.1';

const activeSessions = new Map();

function getActiveSessions() {
  return Object.fromEntries(activeSessions);
}

/**
 * Build the RDP Preconnection PDU v2 (MS-RDPPCB 2.1.1.2)
 * This must be sent as the very first bytes on the TCP connection to port 2179.
 *
 * @param {string} vmGuid - VM GUID string, e.g. "a1b2c3d4-e5f6-..."
 * @returns {Buffer}
 */
function buildPreconnectionPDU(vmGuid) {
  // The PCB string is the GUID in braces: {a1b2c3d4-...}
  const pcbString = vmGuid.startsWith('{') ? vmGuid : `{${vmGuid}}`;

  // Encode as UTF-16LE including null terminator
  const pcbBuf = Buffer.alloc((pcbString.length + 1) * 2);
  for (let i = 0; i < pcbString.length; i++) {
    pcbBuf.writeUInt16LE(pcbString.charCodeAt(i), i * 2);
  }
  // null terminator already zero from Buffer.alloc

  const cchPCB  = pcbString.length + 1; // char count including null
  const cbSize  = 4 + 4 + 4 + pcbBuf.length; // 12 bytes header + string bytes

  const pdu = Buffer.alloc(cbSize);
  pdu.writeUInt32LE(cbSize, 0);   // cbSize
  pdu.writeUInt32LE(2, 4);        // dwFlags = 2 (version with PCB blob)
  pdu.writeUInt32LE(cchPCB, 8);   // cchPCB
  pcbBuf.copy(pdu, 12);           // PCB string

  return pdu;
}

/**
 * Attach the RDP WebSocket proxy to an existing HTTP server.
 * Handles upgrades on /api/rdp
 */
function attach(server) {
  const wss = new WebSocket.Server({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    (async () => {
      const parsed = url.parse(req.url, true);
      if (!parsed.pathname.startsWith('/api/rdp')) return;

      const token = parsed.query.token;
      if (!token) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      let user;
      try {
        user = jwt.verify(token, JWT_SECRET);
      } catch {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      if (!['admin', 'operator', 'user'].includes(user.role)) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }

      const vmName = parsed.query.vm   || 'unknown';
      const vmGuid = parsed.query.guid || '';
      if (!vmGuid) {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
        return;
      }

      const dbUser = await db.get('SELECT discord_id FROM users WHERE id = ?', [user.userId]);
      const flagRow = await db.get("SELECT value FROM settings WHERE `key` = 'discord_whitelist_enabled'");
      const discordWhitelistEnabled = String(flagRow?.value || '0') === '1';
      if (discordWhitelistEnabled) {
        const discordId = dbUser?.discord_id || null;
        if (!discordId) {
          socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
          socket.destroy();
          return;
        }
        const allowed = await db.get('SELECT 1 AS ok FROM discord_whitelist WHERE discord_id = ?', [discordId]);
        if (!allowed) {
          socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
          socket.destroy();
          return;
        }
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req, { user, vmName, vmGuid });
      });
    })().catch(() => {
      try { socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n'); } catch {}
      try { socket.destroy(); } catch {}
    });
  });

  wss.on('connection', (ws, req, { user, vmName, vmGuid }) => {
    console.log(`[rdp] ${user.username} → ${vmName} (GUID: ${vmGuid})`);

    activeSessions.set(vmName, (activeSessions.get(vmName) || 0) + 1);

    let tcpReady = false;
    const sendQueue = [];

    const tcp = net.createConnection({ host: HYPERV_HOST, port: HYPERV_PORT });

    tcp.on('connect', () => {
      console.log(`[rdp] TCP connected to ${HYPERV_HOST}:${HYPERV_PORT} for ${vmName}`);

      // Send preconnection PDU immediately — must be first bytes Hyper-V receives
      const pdu = buildPreconnectionPDU(vmGuid);
      tcp.write(pdu);

      tcpReady = true;

      // Flush any messages queued before TCP was ready
      for (const msg of sendQueue) tcp.write(msg);
      sendQueue.length = 0;
    });

    // Browser → Hyper-V
    ws.on('message', (data) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (tcpReady) {
        tcp.write(buf);
      } else {
        sendQueue.push(buf);
      }
    });

    // Hyper-V → Browser
    tcp.on('data', (data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data, { binary: true });
      }
    });

    tcp.on('error', (err) => {
      console.warn(`[rdp] TCP error for ${vmName}:`, err.message);
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1011, `Hyper-V connection error: ${err.message}`);
      }
    });

    tcp.on('end', () => {
      if (ws.readyState === WebSocket.OPEN) ws.close();
    });

    ws.on('close', () => {
      tcp.destroy();
      const count = (activeSessions.get(vmName) || 1) - 1;
      if (count <= 0) activeSessions.delete(vmName);
      else activeSessions.set(vmName, count);
      console.log(`[rdp] session closed for ${vmName}`);
    });

    ws.on('error', (err) => {
      console.warn(`[rdp] WS error for ${vmName}:`, err.message);
      tcp.destroy();
    });

    const timeout = setTimeout(() => {
      if (ws.readyState === WebSocket.OPEN) ws.close(1001, 'Session timeout');
    }, 4 * 60 * 60 * 1000); // 4 hour max session

    ws.on('close', () => clearTimeout(timeout));
  });

  console.log('✓ RDP/Hyper-V console proxy attached to /api/rdp');
  return wss;
}

module.exports = { attach, getActiveSessions, buildPreconnectionPDU };
