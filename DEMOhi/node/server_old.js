// Minimal Node WebSocket server for POWER SCAN (no overlay drawing)
// Accepts DataURL (image) text frames from client and responds with
// { image: <same data>, combat_stats: { ...zeros } }

const { WebSocketServer } = require('ws');

const PORT = 8765;

function makeResponse(imageDataUrl) {
  return JSON.stringify({
    image: (typeof imageDataUrl === 'string' ? imageDataUrl.trim() : ''),
    combat_stats: {
      base_power: 0,
      pose_bonus: 0,
      expression_bonus: 0,
      speed_bonus: 0,
      total_power: 0,
      height: 0.0,
      reach: 0.0,
      shoulder: 0.0,
      expression: 0.0,
      pose: 0.0,
    },
  });
}

function startServer() {
  const wss = new WebSocketServer({ port: PORT, host: 'localhost' });
  console.log(`POWER SCAN Node WS server started on ws://localhost:${PORT}`);

  wss.on('connection', (ws) => {
    ws.on('message', (data, isBinary) => {
      if (isBinary) return; // client sends text data URLs
      try {
        const text = data.toString('utf8');
        ws.send(makeResponse(text));
      } catch (e) {
        ws.send(makeResponse(''));
      }
    });

    ws.on('error', (err) => {
      console.error('WS error:', err.message);
    });
  });
}

startServer();
