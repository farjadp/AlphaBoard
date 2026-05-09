# AlphaBoard 📈

**AlphaBoard** is an advanced, AI-driven Financial Intelligence Dashboard and Trading Workspace. It bridges the gap between raw market data and actionable trading strategies by leveraging real-time data feeds, comprehensive technical analysis, and multi-modal AI reasoning.

![AlphaBoard Overview](https://img.shields.io/badge/Status-Active-brightgreen.svg) ![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js) ![OpenAI](https://img.shields.io/badge/AI-GPT--4o-blue?logo=openai)

---

## 🚀 Key Features

### 1. Multi-Asset Dashboard
- **Universal Tracking:** Monitor both Cryptocurrency (via Binance) and Traditional Finance/Forex (via Yahoo Finance) in a single pane of glass.
- **Real-Time Data:** Live price tickers, 24h volume, and market capitalization.
- **Futures & Sentiment:** Open Interest, Funding Rates, and real-time news headlines dynamically fetched to provide fundamental context.

### 2. The AI Signal Engine (GPT-4o)
- **Granular Analysis:** Feed real-time RSI, MACD, Bollinger Bands, and multiple SMAs/EMAs directly into GPT-4o.
- **Actionable Execution Plans:** The AI generates precise `BUY`, `SELL`, or `HOLD` signals complete with exact Entry, Take Profit, and Stop Loss levels based on current volatility.
- **Indicator Breakdown:** Explains exactly what each indicator (e.g., 200 SMA, 5 EMA) is signaling in plain English.

### 3. Strategy Archive
- **Historical Backtesting:** Every generated strategy is permanently archived in your browser.
- **Precision Logging:** Stores the exact price, timestamp (down to the second), and the AI's full reasoning at the moment the signal was generated.

### 4. Advanced Trading Journal & Vision AI
- **Professional Metrics:** Log your trades with exchange-level precision, including Margin Mode (Cross/Isolated), Leverage, and Margin Amount.
- **Open Trades:** Log positions without an exit price to track "Open" trades, and update them later to instantly calculate PnL%.
- **AI Screenshot Auto-Fill:** Drag and drop a screenshot of your Binance or Bybit position. The integrated **GPT-4o Vision API** instantly reads the image and auto-fills your journal entry (Asset, Entry Price, Leverage, Margin).

---

## 🛠️ Tech Stack

- **Framework:** Next.js 16 (App Router)
- **Styling:** Tailwind CSS (Custom Glassmorphism UI)
- **Data Providers:**
  - Binance API (Real-time Crypto Klines & Futures Data)
  - Yahoo Finance (`yahoo-finance2`) (TradFi Quotes & History)
  - NewsAPI (Real-time Fundamental Sentiment)
- **Technical Analysis:** `technicalindicators` library (RSI, MACD, BB, SMA, EMA)
- **Artificial Intelligence:** OpenAI API (`gpt-4o` for logic, `gpt-4o` Vision for image parsing)

---

## ⚙️ Setup & Installation

1. **Clone the repository**
   \`\`\`bash
   git clone https://github.com/farjadp/AlphaBoard.git
   cd AlphaBoard
   \`\`\`

2. **Install Dependencies**
   \`\`\`bash
   npm install
   \`\`\`

3. **Environment Variables**
   Create a \`.env.local\` file in the root directory and add the following keys:
   \`\`\`env
   # Required for the Signal Engine and Vision AI
   OPENAI_API_KEY="your_openai_api_key_here"

   # Required for fetching market sentiment
   NEWS_API_KEY="your_newsapi_key_here"
   \`\`\`

4. **Run the Development Server**
   \`\`\`bash
   npm run dev
   \`\`\`
   Visit \`http://localhost:3000\` to access your dashboard.

---

## 🧠 Moving Average Intelligence
The AI Engine is hardcoded to evaluate the market using the following institutional Cheat Sheet:
- \`5 EMA\` : Momentum
- \`10 EMA\`: Short-term trend
- \`20 EMA\`: Mean reversion
- \`50 SMA\`: Strong uptrend support
- \`100 SMA\`: Dip buy alert
- \`200 SMA\`: Trend shift
- \`250 SMA\`: Fair value

---

*Disclaimer: AlphaBoard is an intelligence tool designed to assist in market analysis. It does not provide financial advice. Trading cryptocurrencies and traditional assets carries significant risk.*
