/**
 * In-browser Hyper-V / RDP console — pure Node.js (node-rdpjs-2 + WebSocket).
 *
 * Browser (canvas + input events) ↔ JSON WebSocket ↔ node-rdpjs-2 ↔ TCP RDP
 * Hyper-V VMConnect: host:2179 + preconnection PDU (VM GUID)
 */

const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const url = require('url');
const rdp = require('node-rdpjs-2');
const db = require('./database');
const ps = require('./powershell');
const { buildPreconnectionPDU } = require('./rdpproxy');

const WS_PATH = '/api/rdp-console';
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret';
const HYPERV_HOST = process.env.HYPERV_RDP_HOST || '127.0.0.1';
const HYPERV_PORT = 2179;
const SESSION_TIMEOUT_MS = 4 * 60 * 60 * 1000;

const activeSessions = new Map();

function getWsPath() {
  return WS_PATH;
}

function getActiveSessions() {
  return Object.fromEntries(activeSessions);
}

function sendJson(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

/**
 * node-rdpjs returns early on PROTOCOL_RDP without finishing the handshake.
 * Hyper-V VMConnect negotiates standard RDP security (no TLS).
 */
function patchVmConnectX224(x224) {
  x224.requestedProtocol = 0;
  const orig = x224.recvConnectionConfirm.bind(x224);
  x224.recvConnectionConfirm = function (s) {
    orig(s);
    if (x224.selectedProtocol === 0) {
      x224.transport.on('data', (data) => x224.recvData(data));
      x224.emit('connect', 0);
    }
  };
}

function connectRdpClient(client, host, port, { preconnectionPdu, vmConnect } = {}) {
  if (vmConnect) patchVmConnectX224(client.x224);

  const socket = client.bufferLayer.socket;
  socket.connect(port, host, () => {
    if (preconnectionPdu) socket.write(preconnectionPdu);
    client.x224.connect();
  });
  return client;
}

async function verifyConsoleUser(token) {
  const user = jwt.verify(token, JWT_SECRET);
  if (!['admin', 'operator', 'user', 'viewer'].includes(user.role)) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }

  const dbUser = await db.get('SELECT discord_id FROM users WHERE id = ?', [user.userId]);
  const flagRow = await db.get("SELECT value FROM settings WHERE `key` = 'discord_whitelist_enabled'");
  if (String(flagRow?.value || '0') === '1') {
    const discordId = dbUser?.discord_id || null;
    if (!discordId) {
      const err = new Error('Discord account must be linked for console access');
      err.status = 403;
      throw err;
    }
    const allowed = await db.get('SELECT 1 AS ok FROM discord_whitelist WHERE discord_id = ?', [discordId]);
    if (!allowed) {
      const err = new Error('Discord account not whitelisted for console access');
      err.status = 403;
      throw err;
    }
  }

  return user;
}

async function assertVmAccess(user, vmName) {
  if (user.role !== 'user' && user.role !== 'viewer') return;
  const row = await db.get(
    'SELECT 1 AS ok FROM user_vm_access WHERE user_id = ? AND vm_name = ?',
    [user.userId, vmName]
  );
  if (!row) {
    const err = new Error('Access denied for this VM');
    err.status = 403;
    throw err;
  }
}

async function resolveConnection(vmName, width, height) {
  const override = await db.get(
    'SELECT rdp_port, rdp_host, rdp_username, rdp_password, use_manual FROM vm_console_overrides WHERE vm_name = ?',
    [vmName]
  );
  const useManual = override?.use_manual === 1;
  const screen = {
    width: Math.min(Math.max(parseInt(width, 10) || 1280, 640), 3840),
    height: Math.min(Math.max(parseInt(height, 10) || 720, 480), 2160),
  };

  const clientConfig = {
    userName: override?.rdp_username || '',
    password: override?.rdp_password || '',
    enablePerf: true,
    autoLogin: !!(override?.rdp_username && override?.rdp_password),
    decompress: true,
    screen,
    locale: 'en',
    logLevel: process.env.RDP_LOG_LEVEL || 'ERROR',
  };

  if (useManual && override?.rdp_host) {
    const setting = await db.get("SELECT value FROM settings WHERE `key` = 'console_rdp_port'");
    const port = parseInt(override?.rdp_port || setting?.value || '3389', 10);
    return {
      mode: 'rdp',
      host: override.rdp_host,
      port,
      vmConnect: false,
      preconnectionPdu: null,
      clientConfig,
      screen,
    };
  }

  const guid = await ps.getVMGuid(vmName);
  return {
    mode: 'vmconnect',
    host: HYPERV_HOST,
    port: HYPERV_PORT,
    vmConnect: true,
    preconnectionPdu: buildPreconnectionPDU(guid),
    clientConfig,
    screen,
    guid,
  };
}

function startSession(ws, { user, vmName, width, height }) {
  let rdpClient = null;
  let closed = false;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (rdpClient) {
      try { rdpClient.close(); } catch { /* ignore */ }
      rdpClient = null;
    }
    const count = (activeSessions.get(vmName) || 1) - 1;
    if (count <= 0) activeSessions.delete(vmName);
    else activeSessions.set(vmName, count);
  };

  activeSessions.set(vmName, (activeSessions.get(vmName) || 0) + 1);

  (async () => {
    try {
      await assertVmAccess(user, vmName);
      const conn = await resolveConnection(vmName, width, height);

      rdpClient = rdp.createClient(conn.clientConfig)
        .on('connect', () => {
          console.log(`[rdp-console] connected ${user.username} → ${vmName} (${conn.mode})`);
          sendJson(ws, { type: 'connected', mode: conn.mode, screen: conn.screen });
        })
        .on('bitmap', (bitmap) => {
          const data = Buffer.isBuffer(bitmap.data)
            ? bitmap.data
            : Buffer.from(bitmap.data);
          sendJson(ws, {
            type: 'bitmap',
            destLeft: bitmap.destLeft,
            destTop: bitmap.destTop,
            destRight: bitmap.destRight,
            destBottom: bitmap.destBottom,
            width: bitmap.width,
            height: bitmap.height,
            bitsPerPixel: bitmap.bitsPerPixel,
            isCompress: !!bitmap.isCompress,
            data: data.toString('base64'),
          });
        })
        .on('close', () => {
          sendJson(ws, { type: 'close' });
          ws.close();
          cleanup();
        })
        .on('error', (err) => {
          const msg = err?.message || String(err);
          console.warn(`[rdp-console] error for ${vmName}:`, msg);
          sendJson(ws, { type: 'error', message: msg });
          ws.close(1011, msg);
          cleanup();
        });

      connectRdpClient(rdpClient, conn.host, conn.port, {
        preconnectionPdu: conn.preconnectionPdu,
        vmConnect: conn.vmConnect,
      });
    } catch (err) {
      const msg = err?.message || 'Connection failed';
      sendJson(ws, { type: 'error', message: msg });
      ws.close(1011, msg);
      cleanup();
    }
  })();

  ws.on('message', (raw) => {
    if (!rdpClient) return;
    let msg;
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString());
    } catch {
      return;
    }

    switch (msg.type) {
      case 'mouse':
        rdpClient.sendPointerEvent(msg.x, msg.y, msg.button || 0, !!msg.pressed);
        break;
      case 'scancode':
        rdpClient.sendKeyEventScancode(msg.code, !!msg.pressed, !!msg.extended);
        break;
      case 'unicode':
        rdpClient.sendKeyEventUnicode(msg.code, !!msg.pressed);
        break;
      case 'wheel':
        rdpClient.sendWheelEvent(msg.x, msg.y, msg.step || 1, !!msg.isNegative, !!msg.isHorizontal);
        break;
      default:
        break;
    }
  });

  ws.on('close', () => {
    cleanup();
    console.log(`[rdp-console] session closed for ${vmName}`);
  });

  ws.on('error', () => cleanup());

  const timeout = setTimeout(() => {
    if (ws.readyState === WebSocket.OPEN) ws.close(1001, 'Session timeout');
  }, SESSION_TIMEOUT_MS);
  ws.on('close', () => clearTimeout(timeout));
}

function attach(server) {
  const wss = new WebSocket.Server({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    (async () => {
      const parsed = url.parse(req.url, true);
      if (!parsed.pathname.startsWith(WS_PATH)) return;

      const token = parsed.query.token;
      if (!token) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      let user;
      try {
        user = await verifyConsoleUser(token);
      } catch {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      const vmName = parsed.query.vm || '';
      if (!vmName) {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
        return;
      }

      const width = parsed.query.width;
      const height = parsed.query.height;

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req, { user, vmName, width, height });
      });
    })().catch(() => {
      try { socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n'); } catch { /* ignore */ }
      try { socket.destroy(); } catch { /* ignore */ }
    });
  });

  wss.on('connection', (ws, req, meta) => {
    console.log(`[rdp-console] ${meta.user.username} → ${meta.vmName}`);
    startSession(ws, meta);
  });

  console.log(`✓ Node.js RDP console attached at ${WS_PATH}`);
  return wss;
}

module.exports = {
  attach,
  getWsPath,
  getActiveSessions,
};
