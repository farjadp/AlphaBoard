const urls = [
  "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=1",
  "https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=1",
  "https://api1.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=1",
  "https://api.binance.us/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=1"
];

async function test() {
  for (const url of urls) {
    try {
      const res = await fetch(url);
      console.log(url, res.status, res.statusText);
    } catch (e) {
      console.error(url, e.message);
    }
  }
}
test();
