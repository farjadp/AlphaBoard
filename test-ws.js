const WebSocket = require('ws');
const ws = new WebSocket('wss://data-stream.binance.vision/stream?streams=btcusdt@ticker');

ws.on('open', () => {
  console.log('Connected to data-stream.binance.vision');
});

ws.on('message', (data) => {
  console.log('Message received:', data.toString());
  ws.close();
});

ws.on('error', (err) => {
  console.error('Error:', err);
});
