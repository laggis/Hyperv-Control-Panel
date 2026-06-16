import { useEffect, useRef, useCallback } from 'react';

function wsBaseUrl() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}`;
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function drawBitmap(ctx, bitmap) {
  const outputWidth = bitmap.destRight - bitmap.destLeft + 1;
  const outputHeight = bitmap.destBottom - bitmap.destTop + 1;
  const data = b64ToBytes(bitmap.data);

  const imageData = ctx.createImageData(outputWidth, outputHeight);
  imageData.data.set(data);
  ctx.putImageData(imageData, bitmap.destLeft, bitmap.destTop);
}

export default function CanvasConsole({ vmName, wsPath = '/api/rdp-console', onError, onConnected }) {
  const canvasRef = useRef(null);
  const wsRef = useRef(null);
  const onErrorRef = useRef(onError);
  const onConnectedRef = useRef(onConnected);
  onErrorRef.current = onError;
  onConnectedRef.current = onConnected;

  const send = useCallback((obj) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }, []);

  const getCanvasCoords = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: Math.round((e.clientX - rect.left) * scaleX),
      y: Math.round((e.clientY - rect.top) * scaleY),
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !vmName) return;

    const token = localStorage.getItem('hv_token');
    if (!token) {
      onErrorRef.current?.('Not authenticated');
      return;
    }

    const w = Math.max(canvas.clientWidth || 1280, 640);
    const h = Math.max(canvas.clientHeight || 720, 480);
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);

    const params = new URLSearchParams({
      token,
      vm: vmName,
      width: String(w),
      height: String(h),
    });
    const ws = new WebSocket(`${wsBaseUrl()}${wsPath}?${params}`);
    wsRef.current = ws;

    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }

      if (msg.type === 'bitmap') {
        drawBitmap(ctx, msg);
      } else if (msg.type === 'connected') {
        if (msg.screen) {
          canvas.width = msg.screen.width;
          canvas.height = msg.screen.height;
        }
        onConnectedRef.current?.(msg);
      } else if (msg.type === 'error') {
        onErrorRef.current?.(msg.message || 'Console connection failed');
      } else if (msg.type === 'close') {
        onErrorRef.current?.('Console session closed');
      }
    };

    ws.onerror = () => {
      onErrorRef.current?.('WebSocket connection failed');
    };

    ws.onclose = (ev) => {
      if (ev.code !== 1000 && ev.code !== 1001) {
        const reason = ev.reason || `Connection closed (${ev.code})`;
        onErrorRef.current?.(reason);
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [vmName, wsPath]);

  const onMouseDown = (e) => {
    e.preventDefault();
    canvasRef.current?.focus();
    const { x, y } = getCanvasCoords(e);
    send({ type: 'mouse', x, y, button: e.button + 1, pressed: true });
  };

  const onMouseUp = (e) => {
    e.preventDefault();
    const { x, y } = getCanvasCoords(e);
    send({ type: 'mouse', x, y, button: e.button + 1, pressed: false });
  };

  const onMouseMove = (e) => {
    if (e.buttons === 0) return;
    const { x, y } = getCanvasCoords(e);
    send({ type: 'mouse', x, y, button: 0, pressed: true });
  };

  const onWheel = (e) => {
    e.preventDefault();
    const { x, y } = getCanvasCoords(e);
    send({
      type: 'wheel',
      x,
      y,
      step: Math.abs(e.deltaY) > 50 ? 2 : 1,
      isNegative: e.deltaY > 0,
      isHorizontal: Math.abs(e.deltaX) > Math.abs(e.deltaY),
    });
  };

  const onKeyDown = (e) => {
    e.preventDefault();
    if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
      send({ type: 'unicode', code: e.key.charCodeAt(0), pressed: true });
    } else {
      send({ type: 'scancode', code: e.keyCode, pressed: true });
    }
  };

  const onKeyUp = (e) => {
    e.preventDefault();
    if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
      send({ type: 'unicode', code: e.key.charCodeAt(0), pressed: false });
    } else {
      send({ type: 'scancode', code: e.keyCode, pressed: false });
    }
  };

  return (
    <canvas
      ref={canvasRef}
      tabIndex={0}
      className="w-full h-full block bg-black outline-none cursor-default"
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onMouseMove={onMouseMove}
      onWheel={onWheel}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}
