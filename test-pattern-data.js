// Simulate what XAU/USD Yahoo data looks like for 30 days
// Gold price ~4730, daily moves ~0.5%
const closes = Array.from({length: 30}, (_, i) => 4700 + i * 1.5 + Math.sin(i)*20);
const highs = closes.map(c => c + 15);
const lows = closes.map(c => c - 15);

function regressionSlope(values) {
  const n = values.length;
  const sumX = ((n - 1) * n) / 2;
  const sumY = values.reduce((t, v) => t + v, 0);
  const sumXY = values.reduce((t, v, i) => t + i * v, 0);
  const sumXX = values.reduce((t, _, i) => t + i * i, 0);
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}
function average(values) { return values.reduce((t, v) => t + v, 0) / Math.max(values.length, 1); }

const sample = closes.slice(-14);
const highSlope = regressionSlope(highs.slice(-14)) / Math.max(average(highs.slice(-14)), 1);
const lowSlope = regressionSlope(lows.slice(-14)) / Math.max(average(lows.slice(-14)), 1);
const closeSlope = regressionSlope(sample) / Math.max(average(sample), 1);

console.log('highSlope:', highSlope.toFixed(8), '(need >0.0012 for channel)');
console.log('lowSlope:', lowSlope.toFixed(8));
console.log('closeSlope:', closeSlope.toFixed(8), '(need >0.0012 for bullish channel)');
console.log('Triangle needs highSlope < -0.0008 AND lowSlope > 0.0008');
console.log('Wedge needs slopes > 0.0008');

// For BTC (price ~80000, bigger moves)
const btcCloses = Array.from({length: 30}, (_, i) => 80000 + i * 40 + Math.sin(i)*300);
const btcHighs = btcCloses.map(c => c + 200);
const btcLows = btcCloses.map(c => c - 200);
const btcHighSlope = regressionSlope(btcHighs.slice(-14)) / Math.max(average(btcHighs.slice(-14)), 1);
const btcCloseSlope = regressionSlope(btcCloses.slice(-14)) / Math.max(average(btcCloses.slice(-14)), 1);
console.log('\nBTC highSlope:', btcHighSlope.toFixed(8));
console.log('BTC closeSlope:', btcCloseSlope.toFixed(8));
