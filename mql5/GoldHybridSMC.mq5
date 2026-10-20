//+------------------------------------------------------------------+
//|                                                GoldHybridSMC.mq5 |
//|  Automatic gold EA: H4 trend + H1 liquidity sweep + M15 shift.    |
//|                                                                   |
//|  BUY idea (SELL is the mirror):                                   |
//|   1. Trend  (H4): EMA fast > EMA slow and close > EMA slow        |
//|   2. Sweep  (H1): a closed H1 candle breaks an intact swing low   |
//|                   but closes back above it (stops taken)          |
//|   3. Shift (M15): a closed M15 candle closes above the last M15   |
//|                   swing high that formed before the sweep low     |
//|   4. Entry at market. SL under the sweep low (+ATR buffer).       |
//|   5. Partial close at PartialRR, SL -> breakeven, ATR trailing.   |
//|  Filters: news, spread, volatility, trading hours, daily limits.  |
//|  Mode switch lets you backtest TREND only / SMC only / HYBRID.    |
//+------------------------------------------------------------------+
#property copyright "Custom build"
#property version   "1.20"
#property description "Hybrid (any symbol, ATR-based): H4 trend + H1 liquidity sweep + M15 structure shift, with filters"

#include <Trade/Trade.mqh>

enum ENUM_ENTRY_MODE
  {
   MODE_TREND_ONLY = 0,  // Trend only (H1 pullback to EMA)
   MODE_SMC_ONLY   = 1,  // SMC only (sweep + shift, no trend filter)
   MODE_HYBRID     = 2   // Hybrid (trend + sweep + shift)
  };
enum ENUM_SIZE_MODE
  {
   SIZE_LOT  = 0,        // Fixed lot
   SIZE_RISK = 1         // Risk % of balance per trade
  };

//--- inputs
input group "=== Strategy ==="
input ENUM_ENTRY_MODE InpMode        = MODE_HYBRID; // Entry mode
input int    InpEmaFast              = 50;     // H4 trend EMA fast
input int    InpEmaSlow              = 200;    // H4 trend EMA slow
input int    InpPullbackEma          = 50;     // H1 pullback EMA (trend-only mode)
input int    InpSwingStrength        = 3;      // H1 swing strength (bars each side)
input int    InpSwingLookback        = 48;     // H1 bars to search for liquidity
input int    InpSweepValidHours      = 6;      // Hours a sweep stays valid
input int    InpMssStrength          = 2;      // M15 swing strength for the shift
input int    InpMssLookback          = 40;     // M15 bars to search the shift level

input group "=== Stop loss / take profit ==="
input int    InpAtrPeriod            = 14;     // ATR period (H1)
input double InpSLAtrBuffer          = 0.20;   // SL buffer beyond sweep low (x ATR)
input double InpMinSLAtr             = 0.30;   // Min SL distance (x ATR H1)
input double InpMaxSLAtr             = 2.00;   // Max SL distance (x ATR H1) - bigger = skip
input double InpTPRR                 = 3.0;    // Final TP (x risk), 0 = none
input double InpPartialRR            = 1.0;    // Partial close at (x risk), 0 = off
input double InpPartialPercent       = 50.0;   // Partial close %
input double InpBEBufferAtr          = 0.03;   // Breakeven buffer (x ATR H1)
input double InpTrailAtr             = 1.5;    // Trailing after partial (x ATR), 0 = off

input group "=== Position size ==="
input ENUM_SIZE_MODE InpSizeMode     = SIZE_RISK; // Size mode
input double InpLot                  = 0.01;   // Fixed lot
input double InpRiskPercent          = 1.0;    // Risk % per trade
input double InpManualSLAtr          = 1.0;    // Manual BUY/SELL button: SL distance (x ATR H1)
input bool   InpShowButtons          = true;   // Show control buttons

input group "=== Filters ==="
input bool   InpUseNews              = true;   // News filter (live only, not in tester)
input string InpNewsCurrency         = "USD";  // News currency
input int    InpNewsMinutes          = 90;     // Block minutes before/after high-impact news
input double InpMaxSpreadAtr         = 0.05;   // Max spread (x ATR H1)
input double InpMaxVolRatio          = 2.0;    // Block if ATR > x times its 100-bar average
input int    InpStartHour            = 2;      // Trading start hour (server)
input int    InpEndHour              = 21;     // Trading end hour (server)
input double InpDailyLossPct         = 3.0;    // Daily loss limit % (0 = off)
input double InpDailyProfitPct       = 0.0;    // Daily profit target % (0 = off)
input int    InpMaxTradesPerDay      = 3;      // Max new trades per day

input group "=== Other ==="
input ulong  InpMagic                = 990301; // Magic number
input int    InpSlippagePts          = 30;     // Max slippage (points)
input bool   InpShowPanel            = true;   // Show panel
input int    InpPanelX               = 12;     // Panel X
input int    InpPanelY               = 24;     // Panel Y
input int    InpFontSize             = 9;      // Panel font size

//--- state
struct Sweep
  {
   bool     active;
   datetime t;        // open time of the H1 sweep candle
   double   level;    // swept swing level
  };

CTrade   trade;
int      hEmaFast = INVALID_HANDLE, hEmaSlow = INVALID_HANDLE, hEmaPb = INVALID_HANDLE, hAtr = INVALID_HANDLE;
Sweep    g_bs, g_ss;          // buy setup (low swept), sell setup (high swept)
int      g_trend = 0;         // 1 up, -1 down, 0 none
string   g_filterMsg = "-";
string   g_lastEvent = "-";
string   PANEL = "HYB_PANEL_";
int      g_mode = 1;          // 0 lot, 1 risk %
double   g_lot  = 0.01, g_risk = 1.0;
bool     g_auto = true;       // automatic entries on/off
datetime g_closeArm = 0;      // CLOSE ALL needs a second click within 5 s
#define  CTRL_H 150

//+------------------------------------------------------------------+
//| helpers                                                          |
//+------------------------------------------------------------------+
void Log(const string msg)
  {
   static string last = ""; static datetime lt = 0;
   if(msg == last && TimeCurrent() - lt < 60) return;
   last = msg; lt = TimeCurrent();
   Print("[HYB] ", msg);
  }

string Prefix()                { return "HYB_" + (string)AccountInfoInteger(ACCOUNT_LOGIN) + "_" + (string)InpMagic + "_"; }
string GKey(ulong id, string s){ return Prefix() + (string)id + "_" + s; }
double GGet(ulong id, string s, double def)
  {
   string k = GKey(id, s);
   return GlobalVariableCheck(k) ? GlobalVariableGet(k) : def;
  }
void   GSet(ulong id, string s, double v) { GlobalVariableSet(GKey(id, s), v); }

double NP(double p)
  {
   double ts = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   if(ts > 0) p = MathRound(p / ts) * ts;
   return NormalizeDouble(p, _Digits);
  }

int VolDigits()
  {
   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   int d = 0;
   while(d < 8 && MathAbs(step * MathPow(10, d) - MathRound(step * MathPow(10, d))) > 1e-8) d++;
   return d;
  }

double Buf(int handle, int shift)
  {
   double b[];
   if(CopyBuffer(handle, 0, shift, 1, b) != 1) return EMPTY_VALUE;
   return b[0];
  }

bool TradeOK()
  {
   uint rc = trade.ResultRetcode();
   return (rc == TRADE_RETCODE_DONE || rc == TRADE_RETCODE_PLACED || rc == TRADE_RETCODE_DONE_PARTIAL);
  }

bool ModifyPos(ulong t, double sl, double tp)
  {
   if(!PositionSelectByTicket(t)) return false;
   double ts = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   if(MathAbs(PositionGetDouble(POSITION_SL) - sl) < ts / 2 && MathAbs(PositionGetDouble(POSITION_TP) - tp) < ts / 2) return true;
   double cur  = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) ? SymbolInfoDouble(_Symbol, SYMBOL_BID) : SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double minD = (double)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL) * _Point;
   if(sl > 0 && MathAbs(cur - sl) < minD) return false;      // too close to price right now, try later
   trade.PositionModify(t, sl, tp);
   if(!(TradeOK() || trade.ResultRetcode() == TRADE_RETCODE_NO_CHANGES))
     {
      Log(StringFormat("Modify #%I64u failed: %u %s", t, trade.ResultRetcode(), trade.ResultRetcodeDescription()));
      return false;
     }
   return true;
  }

bool IsSwingLow(ENUM_TIMEFRAMES tf, int j, int k)
  {
   double l = iLow(_Symbol, tf, j);
   for(int m = 1; m <= k; m++)
      if(iLow(_Symbol, tf, j - m) <= l || iLow(_Symbol, tf, j + m) < l) return false;
   return true;
  }

bool IsSwingHigh(ENUM_TIMEFRAMES tf, int j, int k)
  {
   double h = iHigh(_Symbol, tf, j);
   for(int m = 1; m <= k; m++)
      if(iHigh(_Symbol, tf, j - m) >= h || iHigh(_Symbol, tf, j + m) > h) return false;
   return true;
  }

//+------------------------------------------------------------------+
//| trend (H4, closed bar)                                           |
//+------------------------------------------------------------------+
int TrendDir()
  {
   double f = Buf(hEmaFast, 1), s = Buf(hEmaSlow, 1);
   double c = iClose(_Symbol, PERIOD_H4, 1);
   if(f == EMPTY_VALUE || s == EMPTY_VALUE || c == 0) return 0;
   if(f > s && c > s) return 1;
   if(f < s && c < s) return -1;
   return 0;
  }

//+------------------------------------------------------------------+
//| H1 liquidity sweep detection (runs on every new H1 bar)          |
//+------------------------------------------------------------------+
void DetectSweeps()
  {
   int    k  = InpSwingStrength;
   double l1 = iLow(_Symbol, PERIOD_H1, 1);
   double h1 = iHigh(_Symbol, PERIOD_H1, 1);
   double c1 = iClose(_Symbol, PERIOD_H1, 1);
   datetime t1 = iTime(_Symbol, PERIOD_H1, 1);

   // sell-side liquidity (swing lows) -> buy setup
   double minBetween = DBL_MAX;   // lowest low of bars 2..j-1 (to know if level is still intact)
   for(int j = 2; j <= InpSwingLookback; j++)
     {
      if(j >= k + 2 && IsSwingLow(PERIOD_H1, j, k))
        {
         double lv = iLow(_Symbol, PERIOD_H1, j);
         if(minBetween > lv)                         // nobody took it yet
           {
            if(lv < l1) break;                       // candle did not reach it -> nothing deeper either
            if(c1 > lv)
              {
               g_bs.active = true; g_bs.t = t1; g_bs.level = lv;
               g_lastEvent = StringFormat("Buy sweep of %s at %s", DoubleToString(lv, _Digits), TimeToString(t1, TIME_DATE | TIME_MINUTES));
               Log(g_lastEvent);
               break;
              }
            // closed below this level -> check older, deeper levels
           }
        }
      minBetween = MathMin(minBetween, iLow(_Symbol, PERIOD_H1, j));
     }

   // buy-side liquidity (swing highs) -> sell setup
   double maxBetween = -DBL_MAX;
   for(int j = 2; j <= InpSwingLookback; j++)
     {
      if(j >= k + 2 && IsSwingHigh(PERIOD_H1, j, k))
        {
         double lv = iHigh(_Symbol, PERIOD_H1, j);
         if(maxBetween < lv)
           {
            if(lv > h1) break;
            if(c1 < lv)
              {
               g_ss.active = true; g_ss.t = t1; g_ss.level = lv;
               g_lastEvent = StringFormat("Sell sweep of %s at %s", DoubleToString(lv, _Digits), TimeToString(t1, TIME_DATE | TIME_MINUTES));
               Log(g_lastEvent);
               break;
              }
           }
        }
      maxBetween = MathMax(maxBetween, iHigh(_Symbol, PERIOD_H1, j));
     }
  }

//+------------------------------------------------------------------+
//| M15 structure shift after a sweep. Returns true + SL to use.     |
//+------------------------------------------------------------------+
bool CheckShift(bool buy, double &sl)
  {
   Sweep s;
   if(buy) s = g_bs; else s = g_ss;
   if(!s.active) return false;
   if(TimeCurrent() > s.t + 3600 + InpSweepValidHours * 3600) { if(buy) g_bs.active = false; else g_ss.active = false; return false; }

   int sweepIdx = iBarShift(_Symbol, PERIOD_M15, s.t, false);
   if(sweepIdx < 2) return false;

   // extreme since the sweep + invalidation (M15 close back beyond the level after the sweep hour)
   int    exIdx = 1;
   double ex    = buy ? DBL_MAX : -DBL_MAX;
   for(int i = 1; i <= sweepIdx; i++)
     {
      double v = buy ? iLow(_Symbol, PERIOD_M15, i) : iHigh(_Symbol, PERIOD_M15, i);
      if(buy ? (v < ex) : (v > ex)) { ex = v; exIdx = i; }
      if(iTime(_Symbol, PERIOD_M15, i) >= s.t + 3600)
        {
         double c = iClose(_Symbol, PERIOD_M15, i);
         if(buy ? (c < s.level) : (c > s.level))
           {
            if(buy) g_bs.active = false; else g_ss.active = false;
            Log(buy ? "Buy sweep invalidated" : "Sell sweep invalidated");
            return false;
           }
        }
     }
   if(exIdx <= 1) return false;                      // extreme is still being made
   if(ex <= 0 || ex == DBL_MAX || ex == -DBL_MAX) return false;

   // last M15 swing before the extreme = structure level
   int    k   = InpMssStrength;
   double lvl = 0;
   for(int j = exIdx + 1; j <= exIdx + InpMssLookback; j++)
     {
      if(j - k < 1) continue;
      if(buy ? IsSwingHigh(PERIOD_M15, j, k) : IsSwingLow(PERIOD_M15, j, k))
        { lvl = buy ? iHigh(_Symbol, PERIOD_M15, j) : iLow(_Symbol, PERIOD_M15, j); break; }
     }
   if(lvl <= 0) return false;

   double c1 = iClose(_Symbol, PERIOD_M15, 1);
   if(buy ? (c1 <= lvl) : (c1 >= lvl)) return false; // no shift yet

   // if an earlier bar already broke it, the signal is stale
   for(int i = 2; i < exIdx; i++)
     {
      double c = iClose(_Symbol, PERIOD_M15, i);
      if(buy ? (c > lvl) : (c < lvl)) { if(buy) g_bs.active = false; else g_ss.active = false; return false; }
     }

   double atr = Buf(hAtr, 1);
   if(atr == EMPTY_VALUE) return false;
   sl = buy ? ex - atr * InpSLAtrBuffer : ex + atr * InpSLAtrBuffer;
   return true;
  }

//+------------------------------------------------------------------+
//| trend-only entry: H1 pullback candle to the EMA                  |
//+------------------------------------------------------------------+
bool CheckPullback(bool buy, double &sl)
  {
   double ema = Buf(hEmaPb, 1), atr = Buf(hAtr, 1);
   if(ema == EMPTY_VALUE || atr == EMPTY_VALUE) return false;
   double o = iOpen(_Symbol, PERIOD_H1, 1), c = iClose(_Symbol, PERIOD_H1, 1);
   double l = iLow(_Symbol, PERIOD_H1, 1),  h = iHigh(_Symbol, PERIOD_H1, 1);
   if(buy  && l <= ema && c > ema && c > o) { sl = l - atr * InpSLAtrBuffer; return true; }
   if(!buy && h >= ema && c < ema && c < o) { sl = h + atr * InpSLAtrBuffer; return true; }
   return false;
  }

//+------------------------------------------------------------------+
//| history: managed positions + P/L                                 |
//+------------------------------------------------------------------+
struct Agg { ulong id; double net; double netToday; datetime lastOut; bool hasOut; datetime entry; };

int BuildAgg(Agg &a[], datetime from)
  {
   ArrayResize(a, 0);
   datetime ds = DayStart();
   if(!HistorySelect(from, TimeCurrent() + 86400)) return 0;
   int nd = HistoryDealsTotal();
   // pass 1: which positions are ours (entry deal magic)
   ulong ids[];
   for(int i = 0; i < nd; i++)
     {
      ulong d = HistoryDealGetTicket(i);
      if(d == 0 || HistoryDealGetString(d, DEAL_SYMBOL) != _Symbol) continue;
      if((ulong)HistoryDealGetInteger(d, DEAL_MAGIC) != InpMagic) continue;
      if(HistoryDealGetInteger(d, DEAL_ENTRY) != DEAL_ENTRY_IN) continue;
      int k = ArraySize(ids); ArrayResize(ids, k + 1); ids[k] = (ulong)HistoryDealGetInteger(d, DEAL_POSITION_ID);
     }
   // pass 2: sum every deal of those positions
   for(int i = 0; i < nd; i++)
     {
      ulong d = HistoryDealGetTicket(i);
      if(d == 0 || HistoryDealGetString(d, DEAL_SYMBOL) != _Symbol) continue;
      long type = HistoryDealGetInteger(d, DEAL_TYPE);
      if(type != DEAL_TYPE_BUY && type != DEAL_TYPE_SELL) continue;
      ulong pid = (ulong)HistoryDealGetInteger(d, DEAL_POSITION_ID);
      bool mine = false;
      for(int m = 0; m < ArraySize(ids); m++) if(ids[m] == pid) { mine = true; break; }
      if(!mine) continue;
      int k = -1;
      for(int m = 0; m < ArraySize(a); m++) if(a[m].id == pid) { k = m; break; }
      if(k < 0) { k = ArraySize(a); ArrayResize(a, k + 1); a[k].id = pid; a[k].net = 0; a[k].netToday = 0; a[k].lastOut = 0; a[k].hasOut = false; a[k].entry = 0; }
      double dn = HistoryDealGetDouble(d, DEAL_PROFIT) + HistoryDealGetDouble(d, DEAL_SWAP)
                + HistoryDealGetDouble(d, DEAL_COMMISSION) + HistoryDealGetDouble(d, DEAL_FEE);
      datetime t = (datetime)HistoryDealGetInteger(d, DEAL_TIME);
      a[k].net += dn;
      if(t >= ds) a[k].netToday += dn;
      long e = HistoryDealGetInteger(d, DEAL_ENTRY);
      if(e == DEAL_ENTRY_IN) a[k].entry = t;
      if(e == DEAL_ENTRY_OUT || e == DEAL_ENTRY_OUT_BY || e == DEAL_ENTRY_INOUT) { a[k].hasOut = true; if(t > a[k].lastOut) a[k].lastOut = t; }
     }
   return ArraySize(a);
  }

datetime DayStart()
  {
   MqlDateTime d; TimeToStruct(TimeCurrent(), d);
   d.hour = 0; d.min = 0; d.sec = 0;
   return StructToTime(d);
  }

double Floating(int &cnt)
  {
   double f = 0; cnt = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      if(t == 0 || PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if((ulong)PositionGetInteger(POSITION_MAGIC) != InpMagic) continue;
      f += PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
      cnt++;
     }
   return f;
  }

//+------------------------------------------------------------------+
//| filters                                                          |
//+------------------------------------------------------------------+
bool NewsBlocked(string &msg)
  {
   if(!InpUseNews || MQLInfoInteger(MQL_TESTER)) return false;
   static datetime lastCheck = 0, blockUntil = 0;
   static string   blockName = "";
   datetime now = TimeTradeServer();
   if(now - lastCheck >= 300)
     {
      lastCheck = now; blockUntil = 0; blockName = "";
      MqlCalendarValue vals[];
      int n = CalendarValueHistory(vals, now - InpNewsMinutes * 60, now + InpNewsMinutes * 60, NULL, InpNewsCurrency);
      for(int i = 0; i < n; i++)
        {
         MqlCalendarEvent ev;
         if(!CalendarEventById(vals[i].event_id, ev)) continue;
         if(ev.importance != CALENDAR_IMPORTANCE_HIGH) continue;
         datetime end = vals[i].time + InpNewsMinutes * 60;
         if(end > blockUntil) { blockUntil = end; blockName = ev.name; }
        }
     }
   if(now < blockUntil)
     {
      msg = "News (" + blockName + ") until " + TimeToString(blockUntil, TIME_MINUTES);
      return true;
     }
   return false;
  }

bool FiltersOK(string &why)
  {
   why = "OK";
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK), bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double atrNow = Buf(hAtr, 1);
   if(atrNow != EMPTY_VALUE && ask - bid > atrNow * InpMaxSpreadAtr)
     { why = StringFormat("Spread %s > %s", DoubleToString(ask - bid, _Digits), DoubleToString(atrNow * InpMaxSpreadAtr, _Digits)); return false; }

   MqlDateTime d; TimeToStruct(TimeCurrent(), d);
   if(d.hour < InpStartHour || d.hour >= InpEndHour) { why = "Outside trading hours"; return false; }

   if(NewsBlocked(why)) return false;

   double atrv[];
   if(CopyBuffer(hAtr, 0, 1, 100, atrv) == 100)
     {
      double sum = 0; for(int i = 0; i < 100; i++) sum += atrv[i];
      double avg = sum / 100.0, cur = atrv[99];      // atrv[99] = bar 1 (oldest first)
      if(avg > 0 && cur > avg * InpMaxVolRatio) { why = StringFormat("Volatility high (ATR x%.1f)", cur / avg); return false; }
     }

   // daily limits
   Agg a[]; int n = BuildAgg(a, DayStart() - 40 * 86400);
   datetime ds = DayStart();
   double closedToday = 0; int tradesToday = 0;
   for(int i = 0; i < n; i++)
     {
      if(a[i].entry >= ds) tradesToday++;
      closedToday += a[i].netToday;      // only money realized today
     }
   int oc; double fl = Floating(oc);
   double startBal = AccountInfoDouble(ACCOUNT_BALANCE) - closedToday;
   if(InpMaxTradesPerDay > 0 && tradesToday >= InpMaxTradesPerDay) { why = "Max trades today reached"; return false; }
   if(InpDailyLossPct > 0 && closedToday + fl <= -startBal * InpDailyLossPct / 100.0) { why = "Daily loss limit hit"; return false; }
   if(InpDailyProfitPct > 0 && closedToday + fl >= startBal * InpDailyProfitPct / 100.0) { why = "Daily profit target hit"; return false; }
   return true;
  }

//+------------------------------------------------------------------+
//| orders                                                           |
//+------------------------------------------------------------------+
double CalcLot(bool buy, double price, double sl)
  {
   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   double vmin = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double vmax = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   double lot;
   if(g_mode == SIZE_LOT) lot = g_lot;
   else
     {
      double loss = 0;
      if(!OrderCalcProfit(buy ? ORDER_TYPE_BUY : ORDER_TYPE_SELL, _Symbol, 1.0, price, sl, loss) || loss == 0) return 0;
      lot = AccountInfoDouble(ACCOUNT_BALANCE) * g_risk / 100.0 / MathAbs(loss);
     }
   lot = MathFloor(lot / step + 1e-9) * step;
   if(lot < vmin - 1e-9) return 0;
   if(lot > vmax) lot = vmax;
   return NormalizeDouble(lot, VolDigits());
  }

bool HasOpenPosition()
  {
   int c; Floating(c);
   return c > 0;
  }

// returns true when the setup is finished (opened, or can never be traded); false = try again
bool Open(bool buy, double sl, string tag)
  {
   double price = buy ? SymbolInfoDouble(_Symbol, SYMBOL_ASK) : SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double dir   = buy ? 1.0 : -1.0;
   sl = NP(sl);
   double dist = dir * (price - sl);
   double atr = Buf(hAtr, 1);
   if(atr == EMPTY_VALUE || atr <= 0) return false;
   if(dist < atr * InpMinSLAtr || dist > atr * InpMaxSLAtr)
     { Log(StringFormat("%s %s skipped: SL distance %s = %.2f ATR (allowed %.2f-%.2f)", tag, buy ? "BUY" : "SELL",
                        DoubleToString(dist, _Digits), dist / atr, InpMinSLAtr, InpMaxSLAtr)); return true; }
   double tp  = InpTPRR > 0 ? NP(price + dir * dist * InpTPRR) : 0;
   double lot = CalcLot(buy, price, sl);
   if(lot <= 0) { Log(tag + " skipped: risk too small for the minimum lot"); return true; }

   string cmt = "HYB " + tag;
   bool sent = buy ? trade.Buy(lot, _Symbol, 0, sl, tp, cmt) : trade.Sell(lot, _Symbol, 0, sl, tp, cmt);
   if(!sent || !TradeOK())
     { Log(StringFormat("%s %s failed: %u %s", tag, buy ? "BUY" : "SELL", trade.ResultRetcode(), trade.ResultRetcodeDescription())); return false; }
   ulong id = trade.ResultOrder();         // position identifier = opening order ticket
   GSet(id, "r", dist);
   g_lastEvent = StringFormat("%s %s %.2f lot, SL %s, TP %s", tag, buy ? "BUY" : "SELL", lot,
                              DoubleToString(sl, _Digits), tp > 0 ? DoubleToString(tp, _Digits) : "-");
   Log(g_lastEvent);
   return true;
  }

//+------------------------------------------------------------------+
//| position management: partial, breakeven, trailing                |
//+------------------------------------------------------------------+
void ManagePositions()
  {
   int oc; Floating(oc);
   if(oc == 0) return;                     // nothing to manage -> keep backtests fast
   static datetime atrBar = 0;
   static double   atr    = EMPTY_VALUE;
   datetime hb = iTime(_Symbol, PERIOD_H1, 0);
   if(hb != atrBar || atr == EMPTY_VALUE) { atr = Buf(hAtr, 1); atrBar = hb; }
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      if(t == 0 || PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if((ulong)PositionGetInteger(POSITION_MAGIC) != InpMagic) continue;

      ulong  id   = (ulong)PositionGetInteger(POSITION_IDENTIFIER);
      bool   buy  = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY);
      double dir  = buy ? 1.0 : -1.0;
      double open = PositionGetDouble(POSITION_PRICE_OPEN);
      double sl   = PositionGetDouble(POSITION_SL);
      double tp   = PositionGetDouble(POSITION_TP);
      double vol  = PositionGetDouble(POSITION_VOLUME);
      double cur  = buy ? SymbolInfoDouble(_Symbol, SYMBOL_BID) : SymbolInfoDouble(_Symbol, SYMBOL_ASK);

      double r = GGet(id, "r", 0);
      if(r <= 0)
        {
         if(sl <= 0) continue;
         r = MathAbs(open - sl); GSet(id, "r", r);
        }
      double move = dir * (cur - open);
      int    p    = (int)GGet(id, "p", 0);

      // 1) partial close (PartialRR = 0 -> no partial, breakeven at 1R)
      double trigR = InpPartialRR > 0 ? InpPartialRR : 1.0;
      if((p & 1) == 0 && move >= trigR * r)
        {
         if(InpPartialRR > 0)
           {
            double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
            double vmin = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
            int    vd   = VolDigits();
            double cv   = NormalizeDouble(MathFloor(vol * InpPartialPercent / 100.0 / step + 1e-9) * step, vd);
            if(cv >= vmin - 1e-9 && vol - cv >= vmin - 1e-9)
              {
               bool hedging = (AccountInfoInteger(ACCOUNT_MARGIN_MODE) == ACCOUNT_MARGIN_MODE_RETAIL_HEDGING);
               bool sent = hedging ? trade.PositionClosePartial(t, cv, InpSlippagePts)
                                   : (buy ? trade.Sell(cv, _Symbol, 0, 0, 0, "HYB partial")
                                          : trade.Buy(cv, _Symbol, 0, 0, 0, "HYB partial"));
               if(sent && TradeOK())
                  Log(StringFormat("#%I64u partial %.2f lot at %.1fR", id, cv, move / r));
               else
                 {
                  int tries = (int)GGet(id, "pt", 0) + 1; GSet(id, "pt", tries);
                  Log(StringFormat("Partial #%I64u failed: %u (try %d)", t, trade.ResultRetcode(), tries));
                  if(tries < 3) continue;                 // retry, then give up and still protect
                 }
              }
            else Log(StringFormat("#%I64u lot too small to split, only breakeven", id));
           }
         p |= 1; GSet(id, "p", p);
        }

      // 2) breakeven
      if((p & 1) != 0 && (p & 2) == 0)
        {
         if(!PositionSelectByTicket(t)) continue;
         sl = PositionGetDouble(POSITION_SL); tp = PositionGetDouble(POSITION_TP);
         double be = NP(open + dir * (atr != EMPTY_VALUE ? atr * InpBEBufferAtr : 0));
         if(sl == 0 || dir * (be - sl) > 0) { if(!ModifyPos(t, be, tp)) continue; sl = be; }
         p |= 2; GSet(id, "p", p);
        }

      // 3) trailing
      if((p & 2) != 0 && InpTrailAtr > 0 && atr != EMPTY_VALUE)
        {
         double ns = NP(cur - dir * atr * InpTrailAtr);
         if(dir * (ns - sl) > atr * 0.1) ModifyPos(t, ns, tp);
        }
     }
  }

void CleanGlobals()
  {
   string pre = Prefix();
   for(int i = GlobalVariablesTotal() - 1; i >= 0; i--)
     {
      string nm = GlobalVariableName(i);
      if(StringFind(nm, pre) != 0) continue;
      string rest = StringSubstr(nm, StringLen(pre));
      int u = StringFind(rest, "_");
      if(u <= 0) continue;
      if(StringToInteger(StringSubstr(rest, 0, u)) <= 0) continue;
      ulong id = (ulong)StringToInteger(StringSubstr(rest, 0, u));
      bool open = false;
      for(int j = PositionsTotal() - 1; j >= 0; j--)
        {
         ulong t = PositionGetTicket(j);
         if(t != 0 && (ulong)PositionGetInteger(POSITION_IDENTIFIER) == id) { open = true; break; }
        }
      if(!open) GlobalVariableDel(nm);
     }
  }

//+------------------------------------------------------------------+
//| panel                                                            |
//+------------------------------------------------------------------+
void Lbl(string name, int y, string text, color clr)
  {
   string nm = PANEL + name;
   if(ObjectFind(0, nm) < 0)
     {
      ObjectCreate(0, nm, OBJ_LABEL, 0, 0, 0);
      ObjectSetInteger(0, nm, OBJPROP_CORNER, CORNER_LEFT_UPPER);
      ObjectSetString(0, nm, OBJPROP_FONT, "Consolas");
      ObjectSetInteger(0, nm, OBJPROP_FONTSIZE, InpFontSize);
      ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, nm, OBJPROP_HIDDEN, true);
      ObjectSetInteger(0, nm, OBJPROP_XDISTANCE, InpPanelX + 10);
     }
   ObjectSetInteger(0, nm, OBJPROP_YDISTANCE, y);
   ObjectSetInteger(0, nm, OBJPROP_COLOR, clr);
   ObjectSetString(0, nm, OBJPROP_TEXT, text);
  }

void DrawPanel()
  {
   if(!InpShowPanel) return;
   datetime now = TimeCurrent();
   MqlDateTime d; TimeToStruct(now, d);
   int dow = d.day_of_week;
   datetime ds = DayStart();
   datetime ws = ds - ((dow + 6) % 7) * 86400;
   d.day = 1; d.hour = 0; d.min = 0; d.sec = 0;
   datetime ms = StructToTime(d);
   datetime st[3]; st[0] = ds; st[1] = ws; st[2] = ms;

   int cnt[3] = {0, 0, 0}, win[3] = {0, 0, 0};
   double net[3] = {0, 0, 0};
   Agg a[]; int n = BuildAgg(a, (ws < ms ? ws : ms) - 30 * 86400);
   for(int i = 0; i < n; i++)
     {
      if(!a[i].hasOut || PositionSelectByTicket(a[i].id)) continue;
      for(int p = 0; p < 3; p++)
         if(a[i].lastOut >= st[p]) { cnt[p]++; net[p] += a[i].net; if(a[i].net >= 0) win[p]++; }
     }
   int oc; double fl = Floating(oc);

   int lh = InpFontSize + 9, rows = 11;
   string bg = PANEL + "bg";
   if(ObjectFind(0, bg) < 0)
     {
      ObjectCreate(0, bg, OBJ_RECTANGLE_LABEL, 0, 0, 0);
      ObjectSetInteger(0, bg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
      ObjectSetInteger(0, bg, OBJPROP_BORDER_TYPE, BORDER_FLAT);
      ObjectSetInteger(0, bg, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, bg, OBJPROP_HIDDEN, true);
      ObjectSetInteger(0, bg, OBJPROP_BGCOLOR, C'25,25,30');
      ObjectSetInteger(0, bg, OBJPROP_COLOR, clrDimGray);
     }
   ObjectSetInteger(0, bg, OBJPROP_XDISTANCE, InpPanelX);
   ObjectSetInteger(0, bg, OBJPROP_YDISTANCE, InpPanelY);
   ObjectSetInteger(0, bg, OBJPROP_XSIZE, 52 * (InpFontSize - 1) + 20);
   ObjectSetInteger(0, bg, OBJPROP_YSIZE, rows * lh + 12 + (InpShowButtons ? CTRL_H : 0));

   string mode = InpMode == MODE_HYBRID ? "HYBRID" : (InpMode == MODE_SMC_ONLY ? "SMC only" : "Trend only");
   string tr   = g_trend > 0 ? "UP" : (g_trend < 0 ? "DOWN" : "none");
   int y = InpPanelY + 6;
   Lbl("h0", y, "Hybrid SMC | " + _Symbol + " | " + mode, clrGold); y += lh;
   Lbl("t",  y, "Trend H4: " + tr, g_trend > 0 ? clrLimeGreen : (g_trend < 0 ? clrTomato : clrSilver)); y += lh;
   Lbl("bs", y, g_bs.active ? "Buy setup: low " + DoubleToString(g_bs.level, _Digits) + " swept " + TimeToString(g_bs.t, TIME_MINUTES) : "Buy setup: -", clrSilver); y += lh;
   Lbl("ss", y, g_ss.active ? "Sell setup: high " + DoubleToString(g_ss.level, _Digits) + " swept " + TimeToString(g_ss.t, TIME_MINUTES) : "Sell setup: -", clrSilver); y += lh;
   Lbl("f",  y, "Filters: " + g_filterMsg, g_filterMsg == "OK" ? clrLimeGreen : clrOrange); y += lh;
   Lbl("e",  y, "Last: " + g_lastEvent, clrWhite); y += lh;
   Lbl("hd", y, StringFormat("%-10s %6s %4s %5s %10s", "Period", "Trades", "Win", "Win%", "Net $"), clrSilver); y += lh;
   string names[3] = {"Today", "This week", "This month"};
   for(int p = 0; p < 3; p++)
     {
      double wr = cnt[p] > 0 ? 100.0 * win[p] / cnt[p] : 0;
      Lbl("r" + (string)p, y, StringFormat("%-10s %6d %4d %4.0f%% %+10.2f", names[p], cnt[p], win[p], wr, net[p]),
          net[p] > 0 ? clrLimeGreen : (net[p] < 0 ? clrTomato : clrWhite));
      y += lh;
     }
   Lbl("o", y, StringFormat("Open: %d   Floating: %+.2f", oc, fl), fl >= 0 ? clrLimeGreen : clrTomato);
   ChartRedraw(0);
  }

//+------------------------------------------------------------------+
//| control buttons: size mode, manual BUY/SELL, AUTO, CLOSE ALL      |
//+------------------------------------------------------------------+
string UIKey(string s) { return "HYBUI_" + (string)AccountInfoInteger(ACCOUNT_LOGIN) + "_" + _Symbol + "_" + s; }

void SaveUI()
  {
   GlobalVariableSet(UIKey("mode"), g_mode);
   GlobalVariableSet(UIKey("lot"),  g_lot);
   GlobalVariableSet(UIKey("risk"), g_risk);
   GlobalVariableSet(UIKey("auto"), g_auto ? 1 : 0);
  }

void LoadUI()
  {
   g_mode = GlobalVariableCheck(UIKey("mode")) ? (int)GlobalVariableGet(UIKey("mode")) : (int)InpSizeMode;
   g_lot  = GlobalVariableCheck(UIKey("lot"))  ? GlobalVariableGet(UIKey("lot"))  : InpLot;
   g_risk = GlobalVariableCheck(UIKey("risk")) ? GlobalVariableGet(UIKey("risk")) : InpRiskPercent;
   g_auto = GlobalVariableCheck(UIKey("auto")) ? (GlobalVariableGet(UIKey("auto")) > 0.5) : true;
   if(MQLInfoInteger(MQL_TESTER)) { g_mode = (int)InpSizeMode; g_lot = InpLot; g_risk = InpRiskPercent; g_auto = true; }
  }

int PanelW() { return 52 * (InpFontSize - 1) + 20; }

void Btn(string name, int x, int y, int w, int h, string text, color bgc, int fs)
  {
   string nm = PANEL + name;
   if(ObjectFind(0, nm) < 0)
     {
      ObjectCreate(0, nm, OBJ_BUTTON, 0, 0, 0);
      ObjectSetInteger(0, nm, OBJPROP_CORNER, CORNER_LEFT_UPPER);
      ObjectSetString(0, nm, OBJPROP_FONT, "Arial Bold");
      ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, nm, OBJPROP_HIDDEN, true);
      ObjectSetInteger(0, nm, OBJPROP_COLOR, clrWhite);
      ObjectSetInteger(0, nm, OBJPROP_BORDER_COLOR, clrDimGray);
     }
   ObjectSetInteger(0, nm, OBJPROP_XDISTANCE, x);
   ObjectSetInteger(0, nm, OBJPROP_YDISTANCE, y);
   ObjectSetInteger(0, nm, OBJPROP_XSIZE, w);
   ObjectSetInteger(0, nm, OBJPROP_YSIZE, h);
   ObjectSetInteger(0, nm, OBJPROP_FONTSIZE, fs);
   ObjectSetString(0, nm, OBJPROP_TEXT, text);
   ObjectSetInteger(0, nm, OBJPROP_BGCOLOR, bgc);
   ObjectSetInteger(0, nm, OBJPROP_STATE, false);
  }

void UpdateControls(bool setValue)
  {
   if(!InpShowButtons || !InpShowPanel) return;
   int lh = InpFontSize + 9;
   int x  = InpPanelX + 10;
   int y  = InpPanelY + 11 * lh + 12 + 6;
   int W  = PanelW() - 20;
   color off = C'60,60,66';

   // row 1: size mode + value
   Btn("c_lot",  x,      y, 70, 24, "Lot",    g_mode == SIZE_LOT  ? clrSteelBlue : off, 9);
   Btn("c_risk", x + 76, y, 80, 24, "Risk %", g_mode == SIZE_RISK ? clrSteelBlue : off, 9);
   string ed = PANEL + "c_val";
   if(ObjectFind(0, ed) < 0)
     {
      ObjectCreate(0, ed, OBJ_EDIT, 0, 0, 0);
      ObjectSetInteger(0, ed, OBJPROP_CORNER, CORNER_LEFT_UPPER);
      ObjectSetString(0, ed, OBJPROP_FONT, "Consolas");
      ObjectSetInteger(0, ed, OBJPROP_FONTSIZE, 10);
      ObjectSetInteger(0, ed, OBJPROP_ALIGN, ALIGN_CENTER);
      ObjectSetInteger(0, ed, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, ed, OBJPROP_HIDDEN, true);
      ObjectSetInteger(0, ed, OBJPROP_BGCOLOR, clrWhite);
      ObjectSetInteger(0, ed, OBJPROP_COLOR, clrBlack);
     }
   ObjectSetInteger(0, ed, OBJPROP_XDISTANCE, x + 162);
   ObjectSetInteger(0, ed, OBJPROP_YDISTANCE, y);
   ObjectSetInteger(0, ed, OBJPROP_XSIZE, 90);
   ObjectSetInteger(0, ed, OBJPROP_YSIZE, 24);
   if(setValue || ObjectGetString(0, ed, OBJPROP_TEXT) == "")
      ObjectSetString(0, ed, OBJPROP_TEXT, g_mode == SIZE_LOT ? DoubleToString(g_lot, VolDigits()) : DoubleToString(g_risk, 2));
   Lbl("c_unit", y + 5, g_mode == SIZE_LOT ? "lot" : "% of balance per trade", clrSilver);
   ObjectSetInteger(0, PANEL + "c_unit", OBJPROP_XDISTANCE, x + 260);

   // row 2: manual SELL / BUY
   y += 32;
   int bw = (W - 10) / 2;
   Btn("c_sell", x,           y, bw, 34, "SELL", C'200,50,50', 12);
   Btn("c_buy",  x + bw + 10, y, bw, 34, "BUY",  C'30,150,90', 12);

   // row 3: AUTO on/off, CLOSE ALL
   y += 42;
   Btn("c_auto",  x,           y, bw, 26, g_auto ? "AUTO: ON" : "AUTO: OFF", g_auto ? C'30,110,70' : off, 9);
   Btn("c_close", x + bw + 10, y, bw, 26, g_closeArm > 0 ? "CLICK AGAIN TO CLOSE" : "CLOSE ALL", g_closeArm > 0 ? clrOrangeRed : off, 9);

   // row 4: what a manual trade would be
   y += 34;
   string info; color ic = clrWhite;
   double atr = Buf(hAtr, 1);
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   if(atr == EMPTY_VALUE || atr <= 0) info = "Waiting for ATR data";
   else
     {
      double sl  = ask - atr * InpManualSLAtr;
      double lot = CalcLot(true, ask, sl);
      double loss = 0;
      if(lot <= 0) { info = "Risk too small for the minimum lot"; ic = clrTomato; }
      else if(OrderCalcProfit(ORDER_TYPE_BUY, _Symbol, lot, ask, sl, loss))
        {
         double bal = AccountInfoDouble(ACCOUNT_BALANCE);
         double pct = bal > 0 ? 100.0 * MathAbs(loss) / bal : 0;
         info = StringFormat("Manual: %s lot | SL %s | risk -%.2f$ (%.1f%%)", DoubleToString(lot, VolDigits()),
                             DoubleToString(atr * InpManualSLAtr, _Digits), MathAbs(loss), pct);
         ic = pct > 3 ? clrTomato : (pct > 1.5 ? clrOrange : clrLimeGreen);
        }
     }
   Lbl("c_info", y, info, ic);
   ChartRedraw(0);
  }

void ManualTrade(bool buy)
  {
   if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) || !MQLInfoInteger(MQL_TRADE_ALLOWED))
     { Alert("Algo Trading is OFF. Turn it on first."); return; }
   double atr = Buf(hAtr, 1);
   if(atr == EMPTY_VALUE || atr <= 0) { Alert("ATR not ready yet, try again in a moment"); return; }
   double price = buy ? SymbolInfoDouble(_Symbol, SYMBOL_ASK) : SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double sl    = buy ? price - atr * InpManualSLAtr : price + atr * InpManualSLAtr;
   int before; Floating(before);
   Open(buy, sl, "MANUAL");
   int after; Floating(after);
   if(after <= before) Alert("Manual " + (buy ? "BUY" : "SELL") + " was not opened. See the Experts tab: " + g_lastEvent);
  }

void CloseAll()
  {
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      if(t == 0 || PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if((ulong)PositionGetInteger(POSITION_MAGIC) != InpMagic) continue;
      if(!trade.PositionClose(t, InpSlippagePts) || !TradeOK())
         Log(StringFormat("Close #%I64u failed: %u", t, trade.ResultRetcode()));
     }
   g_lastEvent = "CLOSE ALL done";
   Log(g_lastEvent);
  }

void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
  {
   if(!InpShowButtons) return;
   if(id == CHARTEVENT_OBJECT_CLICK)
     {
      if(StringFind(sparam, PANEL + "c_") != 0) return;
      ObjectSetInteger(0, sparam, OBJPROP_STATE, false);
      if(sparam == PANEL + "c_buy")       ManualTrade(true);
      else if(sparam == PANEL + "c_sell") ManualTrade(false);
      else if(sparam == PANEL + "c_lot")  { g_mode = SIZE_LOT;  SaveUI(); }
      else if(sparam == PANEL + "c_risk") { g_mode = SIZE_RISK; SaveUI(); }
      else if(sparam == PANEL + "c_auto") { g_auto = !g_auto; SaveUI(); Log(g_auto ? "AUTO turned ON" : "AUTO turned OFF"); }
      else if(sparam == PANEL + "c_close")
        {
         if(g_closeArm > 0 && TimeCurrent() - g_closeArm <= 5) { g_closeArm = 0; CloseAll(); }
         else g_closeArm = TimeCurrent();
        }
      UpdateControls(true);
     }
   else if(id == CHARTEVENT_OBJECT_ENDEDIT && sparam == PANEL + "c_val")
     {
      string s = ObjectGetString(0, sparam, OBJPROP_TEXT);
      StringReplace(s, ",", ".");
      double v = StringToDouble(s);
      if(g_mode == SIZE_LOT) { if(v > 0) g_lot = v; else Alert("Enter a lot size above 0"); }
      else                   { if(v > 0 && v <= 10) g_risk = v; else Alert("Enter a risk between 0.1 and 10 %"); }
      SaveUI();
      UpdateControls(true);
     }
  }

//+------------------------------------------------------------------+
//| events                                                           |
//+------------------------------------------------------------------+
int OnInit()
  {
   if(InpMinSLAtr <= 0 || InpMaxSLAtr <= InpMinSLAtr || InpPartialPercent <= 0 || InpPartialPercent >= 100)
     { Alert("Gold Hybrid SMC: check the SL and partial inputs"); return INIT_PARAMETERS_INCORRECT; }

   hEmaFast = iMA(_Symbol, PERIOD_H4, InpEmaFast, 0, MODE_EMA, PRICE_CLOSE);
   hEmaSlow = iMA(_Symbol, PERIOD_H4, InpEmaSlow, 0, MODE_EMA, PRICE_CLOSE);
   hEmaPb   = iMA(_Symbol, PERIOD_H1, InpPullbackEma, 0, MODE_EMA, PRICE_CLOSE);
   hAtr     = iATR(_Symbol, PERIOD_H1, InpAtrPeriod);
   if(hEmaFast == INVALID_HANDLE || hEmaSlow == INVALID_HANDLE || hEmaPb == INVALID_HANDLE || hAtr == INVALID_HANDLE)
     { Alert("Gold Hybrid SMC: cannot create indicators"); return INIT_FAILED; }

   trade.SetExpertMagicNumber(InpMagic);
   trade.SetDeviationInPoints(InpSlippagePts);
   trade.SetTypeFillingBySymbol(_Symbol);

   g_bs.active = false; g_ss.active = false;
   LoadUI();
   EventSetTimer(2);
   DrawPanel();                 // background first, so the buttons sit on top of it
   UpdateControls(true);
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   ObjectsDeleteAll(0, PANEL);
   IndicatorRelease(hEmaFast); IndicatorRelease(hEmaSlow); IndicatorRelease(hEmaPb); IndicatorRelease(hAtr);
   ChartRedraw(0);
  }

void OnTick()
  {
   ManagePositions();

   static datetime lastH1 = 0, lastM15 = 0, lastTry = 0;
   static bool     pendH1 = false, pendM15 = false;   // a new bar still waiting for a signal check
   datetime tH1  = iTime(_Symbol, PERIOD_H1, 0);
   datetime tM15 = iTime(_Symbol, PERIOD_M15, 0);
   bool newH1  = (tH1 != lastH1 && tH1 != 0);
   bool newM15 = (tM15 != lastM15 && tM15 != 0);
   if(newH1)  { lastH1 = tH1;   pendH1 = true; }
   if(newM15) { lastM15 = tM15; pendM15 = true; }

   if(newH1 || newM15)
     {
      g_trend = TrendDir();
      if(newH1 && InpMode != MODE_TREND_ONLY && iBars(_Symbol, PERIOD_H1) > InpSwingLookback + InpSwingStrength + 2)
         DetectSweeps();
      lastTry = 0;
     }
   bool pending = (InpMode == MODE_TREND_ONLY) ? pendH1 : pendM15;
   if(!pending) return;
   if(!g_auto) { g_filterMsg = "AUTO is OFF (buttons only)"; return; }
   if(TimeCurrent() - lastTry < 10) return;            // while blocked, re-check every 10 s, not every tick
   lastTry = TimeCurrent();

   string why;
   bool ok = FiltersOK(why);
   g_filterMsg = why;
   if(MQLInfoInteger(MQL_TESTER) && MQLInfoInteger(MQL_VISUAL_MODE)) DrawPanel();
   if(!ok) return;                                     // stay pending, try again on a later tick
   if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) || !MQLInfoInteger(MQL_TRADE_ALLOWED))
     { g_filterMsg = "Algo Trading is OFF"; return; }
   if(HasOpenPosition()) { pendH1 = false; pendM15 = false; return; }

   double sl = 0;
   bool done = true;
   if(InpMode == MODE_TREND_ONLY)
     {
      if(g_trend > 0 && CheckPullback(true, sl))       done = Open(true, sl, "TREND");
      else if(g_trend < 0 && CheckPullback(false, sl)) done = Open(false, sl, "TREND");
     }
   else
     {
      bool allowBuy  = (InpMode == MODE_SMC_ONLY) || g_trend > 0;
      bool allowSell = (InpMode == MODE_SMC_ONLY) || g_trend < 0;
      if(allowBuy && CheckShift(true, sl))        { done = Open(true, sl, "SMC");  if(done) g_bs.active = false; }
      else if(allowSell && CheckShift(false, sl)) { done = Open(false, sl, "SMC"); if(done) g_ss.active = false; }
     }
   if(done) { pendH1 = false; pendM15 = false; }       // failed send -> retry in 10 s
  }

void OnTimer()
  {
   static int k = 0;
   if(MQLInfoInteger(MQL_TESTER) && !MQLInfoInteger(MQL_VISUAL_MODE)) return;   // keep backtests fast
   DrawPanel();
   UpdateControls(false);
   if(g_closeArm > 0 && TimeCurrent() - g_closeArm > 5) g_closeArm = 0;
   if(++k >= 30) { k = 0; CleanGlobals(); }
  }
//+------------------------------------------------------------------+
