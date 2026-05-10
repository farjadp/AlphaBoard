# AlphaBoard 📈

**AlphaBoard** is an advanced, AI-driven Financial Intelligence Dashboard and Trading Workspace. It bridges the gap between raw market data and actionable trading strategies by leveraging real-time data feeds, comprehensive technical analysis, and multi-modal AI reasoning.

![AlphaBoard Overview](https://img.shields.io/badge/Status-Active-brightgreen.svg) ![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js) ![OpenAI](https://img.shields.io/badge/AI-GPT--4o-blue?logo=openai)

---

## 🚀 Key Features

### 1. Multi-Asset Dashboard
- **Universal Tracking:** Monitor 60+ Assets across Cryptocurrency (via Binance) and Traditional Finance, Indices, Commodities, and Forex (via Yahoo Finance) in a single pane of glass.
- **Real-Time Data:** Live price tickers, 24h volume, and market capitalization.
- **Futures & Sentiment:** Open Interest, Funding Rates, and real-time news headlines dynamically fetched to provide fundamental context.

### 2. Institutional-Grade AI Signal Engine (GPT-4o)
- **Deterministic Logic:** Operates with `temperature: 0` to provide highly consistent, logical trading analysis without signal flipping.
- **Advanced Technical Mapping:** Extracts 3 distinct Support and Resistance levels and determines 1-3 highly probable "Safe Entry" zones for every analysis.
- **Capital Preservation:** Explicitly designed to output `HOLD` signals in volatile or low-probability environments to discourage forced entries.
- **Actionable Execution Plans:** When conditions align, the AI generates precise `BUY` or `SELL` signals complete with exact Entry, Take Profit, and Stop Loss levels based on current volatility and structure.

### 3. Strategy Archive & Post-Mortem Learning
- **Historical Backtesting:** Every generated strategy is permanently archived.
- **Contextual Awareness:** Past trades are analyzed to derive lessons, which are then fed back into the core AI Engine for context-aware future decision-making.

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
