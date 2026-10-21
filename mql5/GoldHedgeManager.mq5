//+------------------------------------------------------------------+
//|                                             GoldHedgeManager.mq5 |
//|  Companion EA for MANUAL trades.                                  |
//|  You open P1 by hand -> EA places P2 (same lot) X$ further away   |
//|  and manages both positions by the rules below.                   |
//|                                                                   |
//|  Scenario A (P1 reaches +TriggerPips):                            |
//|     cancel P2 order, close ClosePercent% of P1, P1 SL -> entry.   |
//|  Scenario B (price reaches P2 and fills it):                      |
//|     P2 SL = P2StopLoss $, P1 SL = P1StopLoss $.                   |
//|     If price comes back to P1 entry: close P1, P2 SL -> entry,    |
//|     P2 TP = P1 entry + P2TPPips.                                  |
//|                                                                   |
//|  Attach to ONE chart per symbol. Needs a HEDGING account.         |
//|                                                                   |
//|  1.20: second position optional (off by default), H4 trend        |
//|  filter, distances in 15-min candles (works on any symbol),       |
//|  account-wide guards: daily loss lock, max trades/day, cooldown   |
//|  after a loss, max lot. Backtest: no P2 + trend = best variant.   |
//|  1.21: stop after 2 losses in a row, daily lock 2%, cooldown 30m, |
//|  no daily trade cap (best money-management mix in the backtest).  |
//|  1.23: daily loss counts only today's trades (closed today + open  |
//|  positions opened today); older open positions no longer lock it. |
//|  The lock is re-checked live instead of sticking all day.         |
//+------------------------------------------------------------------+
#property copyright "Custom build"
#property version   "1.23"
#property description "Manual-trade companion: optional second entry, trend filter, risk guards, stats panel"

#include <Trade/Trade.mqh>

enum ENUM_DIST_MODE
  {
   DIST_CANDLE = 0,  // In 15-min candles (any symbol)
   DIST_PRICE  = 1   // In price ($ on gold)
  };

//--- inputs
input group "=== Strategy ==="
input bool   InpUseP2          = false;  // Open the second position (P2) - backtest: off is better
input bool   InpTrendFilter    = true;   // Only trade with the H4 trend (EMA50 vs EMA200)

input group "=== Distances ==="
input ENUM_DIST_MODE InpDistMode = DIST_CANDLE; // How distances are measured
input int    InpCandleBars     = 2000;   // Candle mode: median size of the last N M15 candles = 1 unit
input double InpP2DistanceC    = 1.0;    // Candle mode: P2 distance (candles)        [gold ~ $8]
input double InpP2StopLossC    = 0.625;  // Candle mode: P2 SL from P2 (candles)      [gold ~ $5]
input double InpP1StopLossC    = 1.625;  // Candle mode: P1 SL (candles)              [gold ~ $13]
input double InpTriggerC       = 1.25;   // Candle mode: scenario A trigger (candles) [gold ~ $10]
input double InpP2TPC          = 0.625;  // Candle mode: P2 TP beyond P1 entry        [gold ~ $5]
input double InpBEBufferC      = 0.0375; // Candle mode: breakeven buffer             [gold ~ $0.30]
input double InpP2Distance     = 8.0;    // Price mode: P2 distance from P1 entry ($)
input double InpP2StopLoss     = 5.0;    // Price mode: P2 stop loss from P2 entry ($)
input double InpP1StopLoss     = 13.0;   // Price mode: P1 stop loss from P1 entry ($)
input double InpPipSize        = 0.10;   // Price mode: pip size (gold = 0.10)
input double InpTriggerPips    = 100;    // Price mode: scenario A trigger (pips)
input double InpP2TPPips       = 50;     // Price mode: P2 TP beyond P1 entry (pips)
input double InpBEBuffer       = 0.30;   // Price mode: breakeven buffer ($)

input group "=== Risk guards (whole account, all charts) ==="
input double InpMaxLot         = 0.05;   // Max lot per trade (0 = off) - stops typos like 0.2
input double InpDailyLossPct   = 2.0;    // Daily loss lock, % of balance at day start (0 = off)
input int    InpMaxTradesDay   = 0;      // Max new trades per day (0 = off)
input int    InpMaxConsecLoss  = 2;      // Stop for the day after N losses in a row (0 = off)
input int    InpCooldownMin    = 30;     // No new trade for N minutes after a losing close (0 = off)
input bool   InpEnforceManual  = true;   // Close manual trades opened outside these rules

input group "=== Management ==="
input double InpClosePercent   = 75.0;   // Scenario A: % of P1 to close
input bool   InpManageExisting = false;  // Also manage manual positions opened BEFORE the EA started
input ulong  InpMagic          = 880801; // Magic number for P2 orders
input int    InpSlippagePts    = 30;     // Max slippage (points)

input group "=== Stats panel ==="
input bool   InpShowPanel      = true;   // Show panel
input int    InpPanelX         = 12;     // Panel X
input int    InpPanelY         = 24;     // Panel Y
input int    InpFontSize       = 9;      // Font size
input color  InpTextColor      = clrWhite;      // Text color
input color  InpBgColor        = C'25,25,30';   // Background color

enum ENUM_SIZE_MODE
  {
   SIZE_LOT  = 0,   // Fixed lot
   SIZE_RISK = 1    // Risk % of balance
  };
input group "=== Trade buttons ==="
input bool           InpShowButtons = true;      // Show Buy / Sell buttons
input ENUM_SIZE_MODE InpSizeMode    = SIZE_LOT;  // Default size mode
input double         InpDefaultLot  = 0.01;      // Default lot
input double         InpDefaultRisk = 2.0;       // Default risk % (worst case of the whole set: P1 + P2)
input bool           InpP1StartSL   = true;      // Button trades: put P1 SL (P1StopLoss $) right at open

//--- stages of a set (one set = one manual P1 + its P2)
#define ST_WAIT     0   // P2 pending, waiting for scenario A or B
#define ST_A_DONE   1   // scenario A finished
#define ST_B_ACTIVE 2   // P2 filled, SLs set
#define ST_B_DONE   3   // P1 closed at entry, P2 at BE with TP
#define ST_IGNORED  9   // not managed
#define CTRL_H    112   // height of the Buy/Sell button block (px)
#define PANEL_ROWS  9   // text rows in the stats panel

CTrade   trade;      // P2 orders (magic = InpMagic)
CTrade   tradeP1;    // button trades (magic 0 -> treated like manual P1)
int      g_mode = 0;          // 0 = lot, 1 = risk %
double   g_lot  = 0.01;
double   g_risk = 2.0;
datetime g_start = 0;
ulong    g_managed[];   // position IDs (P1 and P2) handled by this EA, for stats
int      g_timerTick = 0;
string   PANEL = "GHE_PANEL_";

//--- distances in price, refreshed from the candle size (or fixed in price mode)
double   g_unit = 0;                 // median M15 candle (price)
double   g_p2d, g_p2sl, g_p1sl, g_trig, g_p2tp, g_buf;
datetime g_unitAt = 0;
int      g_hFast = INVALID_HANDLE, g_hSlow = INVALID_HANDLE;

//+------------------------------------------------------------------+
//| helpers                                                          |
//+------------------------------------------------------------------+
void Log(const string msg)
  {
   static string   last = "";
   static datetime lt   = 0;
   if(msg == last && TimeCurrent() - lt < 30) return;   // avoid spam
   last = msg; lt = TimeCurrent();
   Print("[GHE] ", msg);
  }

string Prefix()                 { return "GHE_" + (string)AccountInfoInteger(ACCOUNT_LOGIN) + "_" + _Symbol + "_"; }
string GKey(ulong t, string s)  { return Prefix() + (string)t + "_" + s; }
double GGet(ulong t, string s, double def)
  {
   string k = GKey(t, s);
   if(!GlobalVariableCheck(k)) return def;
   return GlobalVariableGet(k);
  }
void   GSet(ulong t, string s, double v) { GlobalVariableSet(GKey(t, s), v); }
void   Cleanup(ulong p1)                 { GlobalVariablesDeleteAll(Prefix() + (string)p1 + "_"); }

double NP(double p)
  {
   double ts = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   if(ts > 0) p = MathRound(p / ts) * ts;
   return NormalizeDouble(p, _Digits);
  }

int VolDigits()
  {
   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   if(step <= 0) return 2;
   int d = 0;
   while(d < 8 && MathAbs(step * MathPow(10, d) - MathRound(step * MathPow(10, d))) > 1e-8) d++;
   return d;
  }

bool TradeOK()
  {
   uint rc = trade.ResultRetcode();
   return (rc == TRADE_RETCODE_DONE || rc == TRADE_RETCODE_PLACED || rc == TRADE_RETCODE_DONE_PARTIAL);
  }

bool ModifyPos(ulong t, double sl, double tp)
  {
   if(!PositionSelectByTicket(t)) return false;
   double cs = PositionGetDouble(POSITION_SL), ct = PositionGetDouble(POSITION_TP);
   double ts = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   if(MathAbs(cs - sl) < ts / 2 && MathAbs(ct - tp) < ts / 2) return true;
   bool sent = trade.PositionModify(t, sl, tp);
   if(!sent || !(TradeOK() || trade.ResultRetcode() == TRADE_RETCODE_NO_CHANGES))
     {
      Log(StringFormat("Modify #%I64u failed: %u %s", t, trade.ResultRetcode(), trade.ResultRetcodeDescription()));
      return false;
     }
   return true;
  }

ulong FindP2Position(ulong orderTicket)
  {
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      if(t == 0) continue;
      if((ulong)PositionGetInteger(POSITION_MAGIC) != InpMagic) continue;
      if((ulong)PositionGetInteger(POSITION_IDENTIFIER) == orderTicket) return t;
     }
   return 0;
  }

//+------------------------------------------------------------------+
//| distances: fixed in price, or a multiple of the median M15 candle |
//+------------------------------------------------------------------+
bool RefreshDistances()
  {
   if(InpDistMode == DIST_PRICE)
     {
      g_unit = 0;
      g_p2d = InpP2Distance; g_p2sl = InpP2StopLoss; g_p1sl = InpP1StopLoss;
      g_trig = InpTriggerPips * InpPipSize; g_p2tp = InpP2TPPips * InpPipSize; g_buf = InpBEBuffer;
      return true;
     }
   if(g_unit > 0 && TimeCurrent() - g_unitAt < 3600) return true;   // refresh hourly
   MqlRates r[];
   int n = CopyRates(_Symbol, PERIOD_M15, 1, InpCandleBars, r);
   if(n < 100) { Log("Not enough M15 history yet for candle-based distances"); return g_unit > 0; }
   double rng[];
   ArrayResize(rng, n);
   for(int i = 0; i < n; i++) rng[i] = r[i].high - r[i].low;
   ArraySort(rng);
   g_unit   = (n % 2 == 1) ? rng[n / 2] : (rng[n / 2 - 1] + rng[n / 2]) / 2.0;
   g_unitAt = TimeCurrent();
   g_p2d  = InpP2DistanceC * g_unit;  g_p2sl = InpP2StopLossC * g_unit;  g_p1sl = InpP1StopLossC * g_unit;
   g_trig = InpTriggerC * g_unit;     g_p2tp = InpP2TPC * g_unit;        g_buf  = InpBEBufferC * g_unit;
   return true;
  }

// distances are frozen per set when it starts, so an hourly refresh never moves a running set
double SD(ulong p1, string key, double def) { return GGet(p1, key, def); }

//+------------------------------------------------------------------+
//| H4 trend: +1 up, -1 down, 0 unknown (last completed H4 bar)      |
//+------------------------------------------------------------------+
int TrendDir()
  {
   if(g_hFast == INVALID_HANDLE || g_hSlow == INVALID_HANDLE) return 0;
   double f[1], s[1];
   if(CopyBuffer(g_hFast, 0, 1, 1, f) != 1 || CopyBuffer(g_hSlow, 0, 1, 1, s) != 1) return 0;
   if(f[0] > s[0]) return 1;
   if(f[0] < s[0]) return -1;
   return 0;
  }

//+------------------------------------------------------------------+
//| account-wide day guards                                          |
//+------------------------------------------------------------------+
datetime DayStart()
  {
   MqlDateTime d; TimeToStruct(TimeCurrent(), d);
   d.hour = 0; d.min = 0; d.sec = 0;
   return StructToTime(d);
  }

datetime g_lockAlerted = 0;   // day the lock alert was shown (one alert per day)

struct DayInfo
  {
   double   closedNet;    // closed P/L today incl. commission and swap, all symbols
   double   floating;     // open P/L now of positions opened today, all symbols
   double   startBal;     // balance at the start of the day
   int      trades;       // new trades opened today (all symbols, P2 orders not counted)
   datetime lastLoss;     // time of the last losing close today
   int      streak;       // losing closes in a row today (a winning close resets it)
  };

void GetDay(DayInfo &di)
  {
   di.closedNet = 0; di.floating = 0; di.trades = 0; di.lastLoss = 0; di.streak = 0;
   datetime from = DayStart();
   if(HistorySelect(from, TimeCurrent() + 60))
     {
      int nd = HistoryDealsTotal();
      for(int i = 0; i < nd; i++)
        {
         ulong t = HistoryDealGetTicket(i);
         if(t == 0) continue;
         long type = HistoryDealGetInteger(t, DEAL_TYPE);
         if(type != DEAL_TYPE_BUY && type != DEAL_TYPE_SELL) continue;
         double v = HistoryDealGetDouble(t, DEAL_PROFIT) + HistoryDealGetDouble(t, DEAL_SWAP)
                  + HistoryDealGetDouble(t, DEAL_COMMISSION) + HistoryDealGetDouble(t, DEAL_FEE);
         di.closedNet += v;
         long entry = HistoryDealGetInteger(t, DEAL_ENTRY);
         if(entry == DEAL_ENTRY_IN && (ulong)HistoryDealGetInteger(t, DEAL_MAGIC) != InpMagic) di.trades++;
         if(entry == DEAL_ENTRY_OUT || entry == DEAL_ENTRY_OUT_BY)
           {
            if(v < 0)
              {
               di.streak++;
               datetime dtm = (datetime)HistoryDealGetInteger(t, DEAL_TIME);
               if(dtm > di.lastLoss) di.lastLoss = dtm;
              }
            else di.streak = 0;
           }
        }
     }
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      if(PositionGetTicket(i) == 0) continue;
      if((datetime)PositionGetInteger(POSITION_TIME) < from) continue;   // older positions are not today's loss
      di.floating += PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
     }
   di.startBal = AccountInfoDouble(ACCOUNT_BALANCE) - di.closedNet;
  }

bool DayLocked(const DayInfo &di)
  {
   if(InpDailyLossPct <= 0) return false;
   double limit = di.startBal * InpDailyLossPct / 100.0;
   if(di.startBal <= 0 || di.closedNet + di.floating > -limit) return false;
   if(g_lockAlerted != DayStart())
     {
      g_lockAlerted = DayStart();
      Alert(StringFormat("Daily loss limit %.1f%% reached: today %.2f$ (limit -%.2f$). No new trades today.",
                         InpDailyLossPct, di.closedNet + di.floating, limit));
     }
   return true;
  }

// can a trade in direction dir with this lot be opened (or kept, when opened=true)?
bool Allowed(int dir, double lot, bool opened, datetime when, string &why)
  {
   if(InpMaxLot > 0 && lot > InpMaxLot + 1e-9)
     { why = StringFormat("lot %.2f is above the max %.2f", lot, InpMaxLot); return false; }
   if(InpTrendFilter)
     {
      int tr = TrendDir();
      if(tr == 0)   { why = "H4 trend not ready"; return false; }
      if(tr != dir) { why = StringFormat("against the H4 trend (%s)", tr > 0 ? "UP" : "DOWN"); return false; }
     }
   DayInfo di; GetDay(di);
   if(DayLocked(di))
     { why = StringFormat("daily loss %.2f$ (limit -%.0f$)", di.closedNet + di.floating, di.startBal * InpDailyLossPct / 100.0); return false; }
   if(InpMaxConsecLoss > 0 && di.streak >= InpMaxConsecLoss)
     { why = StringFormat("%d losses in a row - done for today", di.streak); return false; }
   if(InpMaxTradesDay > 0 && (opened ? di.trades > InpMaxTradesDay : di.trades >= InpMaxTradesDay))
     { why = StringFormat("max %d trades today", InpMaxTradesDay); return false; }
   if(InpCooldownMin > 0 && di.lastLoss > 0 && when - di.lastLoss >= 0 && when - di.lastLoss < InpCooldownMin * 60)
     {
      int left = (int)((di.lastLoss + InpCooldownMin * 60 - when) / 60) + 1;
      why = StringFormat("cooldown after a loss, %d min left", left);
      return false;
     }
   why = "";
   return true;
  }

//--- managed list (file), used by the stats panel
string FName() { return "GHE_" + (string)AccountInfoInteger(ACCOUNT_LOGIN) + "_" + _Symbol + ".txt"; }

bool IsManaged(ulong id)
  {
   for(int i = ArraySize(g_managed) - 1; i >= 0; i--)
      if(g_managed[i] == id) return true;
   return false;
  }

void LoadManaged()
  {
   ArrayResize(g_managed, 0);
   int h = FileOpen(FName(), FILE_READ | FILE_TXT | FILE_ANSI);
   if(h == INVALID_HANDLE) return;
   while(!FileIsEnding(h))
     {
      string s = FileReadString(h);
      StringTrimLeft(s); StringTrimRight(s);
      ulong v = (ulong)StringToInteger(s);
      if(v > 0 && !IsManaged(v))
        {
         int k = ArraySize(g_managed);
         ArrayResize(g_managed, k + 1);
         g_managed[k] = v;
        }
     }
   FileClose(h);
  }

void AddManaged(ulong id)
  {
   if(id == 0 || IsManaged(id)) return;
   int k = ArraySize(g_managed);
   ArrayResize(g_managed, k + 1);
   g_managed[k] = id;
   int h = FileOpen(FName(), FILE_READ | FILE_WRITE | FILE_TXT | FILE_ANSI);
   if(h == INVALID_HANDLE) { Log("Cannot write managed list file"); return; }
   FileSeek(h, 0, SEEK_END);
   FileWriteString(h, (string)id + "\r\n");
   FileClose(h);
  }

int CollectSets(ulong &arr[])
  {
   ArrayResize(arr, 0);
   string pre = Prefix();
   int pl = StringLen(pre);
   int n = GlobalVariablesTotal();
   for(int i = 0; i < n; i++)
     {
      string nm = GlobalVariableName(i);
      if(StringFind(nm, pre) != 0) continue;
      int L = StringLen(nm);
      if(L <= pl + 3 || StringSubstr(nm, L - 3) != "_st") continue;
      ulong t = (ulong)StringToInteger(StringSubstr(nm, pl, L - 3 - pl));
      if(t == 0) continue;
      int k = ArraySize(arr);
      ArrayResize(arr, k + 1);
      arr[k] = t;
     }
   return ArraySize(arr);
  }

//+------------------------------------------------------------------+
//| new manual position -> place P2                                  |
//+------------------------------------------------------------------+
void StartSet(ulong p1)
  {
   if(!PositionSelectByTicket(p1)) return;
   bool   buy  = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY);
   double dir  = buy ? 1.0 : -1.0;
   double open = PositionGetDouble(POSITION_PRICE_OPEN);
   double vol  = PositionGetDouble(POSITION_VOLUME);
   double curSL = PositionGetDouble(POSITION_SL);
   double curTP = PositionGetDouble(POSITION_TP);
   datetime opened = (datetime)PositionGetInteger(POSITION_TIME);

   if(!RefreshDistances()) return;                      // try again on the next pass

   // rules: a trade opened outside them is closed (or only reported)
   string why;
   if(!Allowed((int)dir, vol, true, opened, why))
     {
      if(InpEnforceManual)
        {
         if(!trade.PositionClose(p1, InpSlippagePts) || !TradeOK())
           { Log(StringFormat("#%I64u: breaks a rule (%s) but close failed: %u", p1, why, trade.ResultRetcode())); return; }
         Alert(StringFormat("%s %s closed: %s", _Symbol, buy ? "BUY" : "SELL", why));
        }
      else
         Alert(StringFormat("%s %s breaks a rule: %s (not managed)", _Symbol, buy ? "BUY" : "SELL", why));
      GSet(p1, "st", ST_IGNORED);
      return;
     }

   // freeze this set's distances
   GSet(p1, "p2d", g_p2d); GSet(p1, "p2sl", g_p2sl); GSet(p1, "p1sl", g_p1sl);
   GSet(p1, "trig", g_trig); GSet(p1, "p2tp", g_p2tp); GSet(p1, "buf", g_buf);

   if(!InpUseP2)
     {
      // single position: make sure it has a stop, then only scenario A applies
      if(curSL == 0.0 && !ModifyPos(p1, NP(open - dir * g_p1sl), curTP)) return;
      GSet(p1, "p2", 0);
      GSet(p1, "st", ST_WAIT);
      AddManaged(p1);
      Log(StringFormat("#%I64u: managed without P2, SL %s", p1, DoubleToString(curSL != 0.0 ? curSL : NP(open - dir * g_p1sl), _Digits)));
      return;
     }

   double px = NP(open - dir * g_p2d);
   double sl = NP(px - dir * g_p2sl);
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);

   if(buy ? (px >= ask) : (px <= bid))
     {
      GSet(p1, "st", ST_IGNORED);
      Log(StringFormat("#%I64u: price already passed the P2 level, set not managed", p1));
      return;
     }

   string cmt  = "GHE P2 " + (string)p1;
   bool   sent = buy ? trade.BuyLimit(vol, px, _Symbol, sl, 0, ORDER_TIME_GTC, 0, cmt)
                     : trade.SellLimit(vol, px, _Symbol, sl, 0, ORDER_TIME_GTC, 0, cmt);
   if(!sent || !TradeOK())
     {
      int tries = (int)GGet(p1, "try", 0) + 1;
      GSet(p1, "try", tries);
      Log(StringFormat("#%I64u: P2 order failed (%u %s), try %d", p1, trade.ResultRetcode(), trade.ResultRetcodeDescription(), tries));
      if(tries >= 3) { GSet(p1, "st", ST_IGNORED); Log(StringFormat("#%I64u: gave up placing P2", p1)); }
      return;
     }

   ulong ord = trade.ResultOrder();
   GSet(p1, "p2", (double)ord);
   GSet(p1, "st", ST_WAIT);
   AddManaged(p1);
   AddManaged(ord);   // in hedging mode the P2 position ID = this order ticket
   Log(StringFormat("#%I64u: P2 %s limit placed @ %s, lot %.2f, SL %s", p1, buy ? "buy" : "sell",
                    DoubleToString(px, _Digits), vol, DoubleToString(sl, _Digits)));
  }

//+------------------------------------------------------------------+
//| Scenario A: P1 in profit                                         |
//+------------------------------------------------------------------+
void ScenarioA(ulong p1, ulong p2, bool p2Pending, ulong p2Pos, double dir, double p1Open, double p1Vol)
  {
   int a = (int)GGet(p1, "a", 0);

   // 1) cancel P2
   if((a & 1) == 0)
     {
      if(p2Pending)
        {
         if(!trade.OrderDelete(p2) || !TradeOK())
           { Log(StringFormat("#%I64u: cancel P2 failed: %u", p1, trade.ResultRetcode())); return; }
        }
      else if(p2Pos > 0) return;      // P2 got filled in the meantime -> scenario B handles it
      a |= 1; GSet(p1, "a", a);
      Log(StringFormat("#%I64u: scenario A - P2 cancelled", p1));
     }

   // 2) close part of P1
   if((a & 2) == 0)
     {
      double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
      double vmin = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
      int    vd   = VolDigits();
      double cv   = NormalizeDouble(MathFloor(p1Vol * InpClosePercent / 100.0 / step + 1e-9) * step, vd);
      double rem  = NormalizeDouble(p1Vol - cv, vd);

      if(cv < vmin - 1e-9 || rem < vmin - 1e-9)
        {
         // lot too small to split -> close all of it
         if(!trade.PositionClose(p1, InpSlippagePts) || !TradeOK())
           { Log(StringFormat("#%I64u: close P1 failed: %u", p1, trade.ResultRetcode())); return; }
         GSet(p1, "a", 7); GSet(p1, "st", ST_A_DONE);
         Log(StringFormat("#%I64u: lot %.2f too small to split, closed 100%%", p1, p1Vol));
         return;
        }
      if(!trade.PositionClosePartial(p1, cv, InpSlippagePts) || !TradeOK())
        { Log(StringFormat("#%I64u: partial close failed: %u", p1, trade.ResultRetcode())); return; }
      a |= 2; GSet(p1, "a", a);
      Log(StringFormat("#%I64u: scenario A - closed %.2f lot, %.2f left", p1, cv, rem));
     }

   // 3) P1 SL -> entry (+buffer)
   if((a & 4) == 0)
     {
      if(!PositionSelectByTicket(p1)) { GSet(p1, "st", ST_A_DONE); return; }
      double cur = PositionGetDouble(POSITION_SL);
      double tp  = PositionGetDouble(POSITION_TP);
      double be  = NP(p1Open + dir * SD(p1, "buf", g_buf));
      bool better = (cur == 0.0 || dir * (be - cur) > 0);
      if(better && !ModifyPos(p1, be, tp)) return;
      a |= 4; GSet(p1, "a", a);
      Log(StringFormat("#%I64u: scenario A - SL moved to %s", p1, DoubleToString(be, _Digits)));
     }

   GSet(p1, "st", ST_A_DONE);
  }

//+------------------------------------------------------------------+
//| Scenario B, final step: price back at P1 entry                   |
//+------------------------------------------------------------------+
void ScenarioB2(ulong p1, ulong p2Pos, double dir, double p1Open, double p2Open, double closePx)
  {
   int b = (int)GGet(p1, "b", 0);

   // 1) P2: SL -> entry (+buffer), TP = P1 entry + P2TPPips
   if((b & 1) == 0)
     {
      if(p2Pos > 0)
        {
         double tp = NP(p1Open + dir * SD(p1, "p2tp", g_p2tp));
         double sl = NP(p2Open + dir * SD(p1, "buf", g_buf));
         if(dir * (closePx - tp) >= 0)
           {
            // price already beyond the TP (gap) -> take it now
            if(!trade.PositionClose(p2Pos, InpSlippagePts) || !TradeOK()) return;
           }
         else if(!ModifyPos(p2Pos, sl, tp)) return;
         Log(StringFormat("#%I64u: scenario B - P2 SL %s, TP %s", p1, DoubleToString(sl, _Digits), DoubleToString(tp, _Digits)));
        }
      b |= 1; GSet(p1, "b", b);
     }

   // 2) close P1
   if((b & 2) == 0)
     {
      if(PositionSelectByTicket(p1))
        {
         if(!trade.PositionClose(p1, InpSlippagePts) || !TradeOK())
           { Log(StringFormat("#%I64u: close P1 failed: %u", p1, trade.ResultRetcode())); return; }
        }
      b |= 2; GSet(p1, "b", b);
      Log(StringFormat("#%I64u: scenario B - P1 closed at entry", p1));
     }

   GSet(p1, "st", ST_B_DONE);
  }

//+------------------------------------------------------------------+
//| process one set                                                  |
//+------------------------------------------------------------------+
void ProcessSet(ulong p1)
  {
   int   st = (int)GGet(p1, "st", ST_WAIT);
   ulong p2 = (ulong)GGet(p1, "p2", 0);

   bool  p2Pending = (p2 > 0 && OrderSelect(p2));
   ulong p2Pos     = (p2 > 0) ? FindP2Position(p2) : 0;
   double p2Open = 0, p2TP = 0;
   if(p2Pos > 0 && PositionSelectByTicket(p2Pos))
     {
      p2Open = PositionGetDouble(POSITION_PRICE_OPEN);
      p2TP   = PositionGetDouble(POSITION_TP);
     }

   //--- P1 no longer open
   if(!PositionSelectByTicket(p1))
     {
      if(st != ST_IGNORED && p2Pending)
        {
         if(trade.OrderDelete(p2) && TradeOK()) Log(StringFormat("#%I64u: P1 closed, P2 order deleted", p1));
         return;                                    // cleanup on the next pass
        }
      if(p2Pos == 0) Cleanup(p1);                   // nothing left -> forget the set
      return;                                       // P2 alone keeps its own SL/TP
     }
   if(st == ST_IGNORED) return;

   bool   buy    = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY);
   double dir    = buy ? 1.0 : -1.0;
   double p1Open = PositionGetDouble(POSITION_PRICE_OPEN);
   double p1Vol  = PositionGetDouble(POSITION_VOLUME);
   double p1TP   = PositionGetDouble(POSITION_TP);
   double closePx = buy ? SymbolInfoDouble(_Symbol, SYMBOL_BID) : SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double move    = dir * (closePx - p1Open);       // + = P1 in profit

   switch(st)
     {
      case ST_WAIT:
         if(GGet(p1, "a", 0) > 0) { ScenarioA(p1, p2, p2Pending, p2Pos, dir, p1Open, p1Vol); return; }
         if(p2Pos > 0)
           {
            // Scenario B step 1: P2 filled -> set both SLs
            bool ok2 = ModifyPos(p2Pos, NP(p2Open - dir * SD(p1, "p2sl", g_p2sl)), p2TP);
            bool ok1 = ModifyPos(p1,    NP(p1Open - dir * SD(p1, "p1sl", g_p1sl)), p1TP);
            if(ok1 && ok2)
              {
               GSet(p1, "st", ST_B_ACTIVE);
               Log(StringFormat("#%I64u: scenario B - P2 filled @ %s, SLs set", p1, DoubleToString(p2Open, _Digits)));
              }
            return;
           }
         if(move >= SD(p1, "trig", g_trig) - 1e-9)
            ScenarioA(p1, p2, p2Pending, p2Pos, dir, p1Open, p1Vol);
         return;

      case ST_A_DONE:
         if(p2Pending) trade.OrderDelete(p2);
         return;

      case ST_B_ACTIVE:
         if(GGet(p1, "b", 0) > 0 || move >= SD(p1, "buf", g_buf) - 1e-9)
            ScenarioB2(p1, p2Pos, dir, p1Open, p2Open, closePx);
         return;
     }
  }

//+------------------------------------------------------------------+
//| which switch stops the expert from trading ("" = none)           |
//+------------------------------------------------------------------+
string TradingBlockedBy()
  {
   if(!TerminalInfoInteger(TERMINAL_CONNECTED))      return "the terminal is not connected to the broker";
   if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED))  return "the Algo Trading button in the toolbar is OFF - click it until it turns green";
   if(!MQLInfoInteger(MQL_TRADE_ALLOWED))            return "this expert's own switch is OFF - chart: double-click the expert name, Common tab, tick 'Allow Algo Trading'";
   if(!AccountInfoInteger(ACCOUNT_TRADE_EXPERT))     return "the broker does not allow experts on this account";
   if(!AccountInfoInteger(ACCOUNT_TRADE_ALLOWED))    return "trading is not allowed on this account right now";
   return "";
  }

//+------------------------------------------------------------------+
//| main loop                                                        |
//+------------------------------------------------------------------+
void Manage()
  {
   string blocked = TradingBlockedBy();
   if(blocked != "") { Log("Not managing trades: " + blocked); return; }

   // 1) discover new manual positions on this symbol
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      if(t == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if(PositionGetInteger(POSITION_MAGIC) != 0) continue;         // manual trades only
      if(GlobalVariableCheck(GKey(t, "st"))) continue;              // already known
      if(!InpManageExisting && (datetime)PositionGetInteger(POSITION_TIME) < g_start)
        { GSet(t, "st", ST_IGNORED); continue; }
      StartSet(t);
     }

   // 2) manage known sets
   ulong sets[];
   int n = CollectSets(sets);
   for(int i = 0; i < n; i++) ProcessSet(sets[i]);
  }

//+------------------------------------------------------------------+
//| stats panel                                                      |
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
     }
   ObjectSetInteger(0, nm, OBJPROP_XDISTANCE, InpPanelX + 10);
   ObjectSetInteger(0, nm, OBJPROP_YDISTANCE, y);
   ObjectSetInteger(0, nm, OBJPROP_COLOR, clr);
   ObjectSetString(0, nm, OBJPROP_TEXT, text);
  }

void DrawPanel()
  {
   if(!InpShowPanel) return;

   // period starts (server time)
   datetime now = TimeCurrent();
   MqlDateTime d; TimeToStruct(now, d);
   int dow = d.day_of_week;
   d.hour = 0; d.min = 0; d.sec = 0;
   datetime dayStart   = StructToTime(d);
   datetime weekStart  = dayStart - ((dow + 6) % 7) * 86400;   // Monday
   d.day = 1;
   datetime monthStart = StructToTime(d);
   datetime starts[3]; starts[0] = dayStart; starts[1] = weekStart; starts[2] = monthStart;

   int    cnt[3]  = {0, 0, 0}, win[3] = {0, 0, 0}, los[3] = {0, 0, 0};
   double net[3]  = {0, 0, 0};

   // aggregate deals per position
   ulong    ids[]; double pnet[]; datetime pout[]; bool phas[];
   datetime from = (weekStart < monthStart ? weekStart : monthStart) - 30 * 86400;
   if(HistorySelect(from, now + 86400))
     {
      int nd = HistoryDealsTotal();
      for(int i = 0; i < nd; i++)
        {
         ulong dt = HistoryDealGetTicket(i);
         if(dt == 0) continue;
         if(HistoryDealGetString(dt, DEAL_SYMBOL) != _Symbol) continue;
         long type = HistoryDealGetInteger(dt, DEAL_TYPE);
         if(type != DEAL_TYPE_BUY && type != DEAL_TYPE_SELL) continue;
         ulong pid = (ulong)HistoryDealGetInteger(dt, DEAL_POSITION_ID);
         if(!IsManaged(pid)) continue;

         double v = HistoryDealGetDouble(dt, DEAL_PROFIT) + HistoryDealGetDouble(dt, DEAL_SWAP)
                  + HistoryDealGetDouble(dt, DEAL_COMMISSION) + HistoryDealGetDouble(dt, DEAL_FEE);
         long entry = HistoryDealGetInteger(dt, DEAL_ENTRY);
         datetime t = (datetime)HistoryDealGetInteger(dt, DEAL_TIME);

         int k = -1;
         for(int j = ArraySize(ids) - 1; j >= 0; j--) if(ids[j] == pid) { k = j; break; }
         if(k < 0)
           {
            k = ArraySize(ids);
            ArrayResize(ids, k + 1); ArrayResize(pnet, k + 1); ArrayResize(pout, k + 1); ArrayResize(phas, k + 1);
            ids[k] = pid; pnet[k] = 0; pout[k] = 0; phas[k] = false;
           }
         pnet[k] += v;
         if(entry == DEAL_ENTRY_OUT || entry == DEAL_ENTRY_OUT_BY || entry == DEAL_ENTRY_INOUT)
           { phas[k] = true; if(t > pout[k]) pout[k] = t; }
        }
     }

   for(int k = 0; k < ArraySize(ids); k++)
     {
      if(!phas[k]) continue;
      if(PositionSelectByTicket(ids[k])) continue;   // still open (e.g. 25% runner) -> counted when closed
      for(int p = 0; p < 3; p++)
        {
         if(pout[k] < starts[p]) continue;
         cnt[p]++; net[p] += pnet[k];
         if(pnet[k] >= 0) win[p]++; else los[p]++;
        }
     }

   // open exposure
   double floating = 0; int openPos = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      if(t == 0 || PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if(!IsManaged((ulong)PositionGetInteger(POSITION_IDENTIFIER))) continue;
      floating += PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
      openPos++;
     }

   // draw
   int lh = InpFontSize + 9;
   int rows = PANEL_ROWS;
   string bg = PANEL + "bg";
   if(ObjectFind(0, bg) < 0)
     {
      ObjectCreate(0, bg, OBJ_RECTANGLE_LABEL, 0, 0, 0);
      ObjectSetInteger(0, bg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
      ObjectSetInteger(0, bg, OBJPROP_BORDER_TYPE, BORDER_FLAT);
      ObjectSetInteger(0, bg, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, bg, OBJPROP_HIDDEN, true);
     }
   ObjectSetInteger(0, bg, OBJPROP_XDISTANCE, InpPanelX);
   ObjectSetInteger(0, bg, OBJPROP_YDISTANCE, InpPanelY);
   ObjectSetInteger(0, bg, OBJPROP_XSIZE, 46 * (InpFontSize - 1) + 20);
   ObjectSetInteger(0, bg, OBJPROP_YSIZE, rows * lh + 12 + (InpShowButtons ? CTRL_H : 0));
   ObjectSetInteger(0, bg, OBJPROP_BGCOLOR, InpBgColor);
   ObjectSetInteger(0, bg, OBJPROP_COLOR, clrDimGray);

   int y = InpPanelY + 6;
   Lbl("h0", y, "Gold Hedge Manager  |  " + _Symbol, clrGold); y += lh;
   Lbl("h1", y, StringFormat("%-10s %6s %4s %4s %5s %10s", "Period", "Trades", "Win", "Loss", "Win%", "Net $"), clrSilver); y += lh;
   string names[3] = {"Today", "This week", "This month"};
   for(int p = 0; p < 3; p++)
     {
      double wr = cnt[p] > 0 ? 100.0 * win[p] / cnt[p] : 0;
      color c = net[p] > 0 ? clrLimeGreen : (net[p] < 0 ? clrTomato : InpTextColor);
      Lbl("r" + (string)p, y, StringFormat("%-10s %6d %4d %4d %4.0f%% %+10.2f", names[p], cnt[p], win[p], los[p], wr, net[p]), c);
      y += lh;
     }
   ulong sets[]; int ns = CollectSets(sets), active = 0;
   for(int i = 0; i < ns; i++) if((int)GGet(sets[i], "st", 0) != ST_IGNORED) active++;
   Lbl("o1", y, StringFormat("Open positions: %d   Active sets: %d", openPos, active), InpTextColor); y += lh;
   Lbl("o2", y, StringFormat("Floating P/L: %+.2f", floating), floating >= 0 ? clrLimeGreen : clrTomato); y += lh;

   // rules
   int tr = TrendDir();
   string trs = !InpTrendFilter ? "off" : (tr > 0 ? "UP" : (tr < 0 ? "DOWN" : "n/a"));
   DayInfo di; GetDay(di);
   string lim = InpMaxTradesDay > 0 ? StringFormat("/%d", InpMaxTradesDay) : "";
   Lbl("g1", y, StringFormat("Trend H4: %s  Trades: %d%s  Losses in a row: %d/%d", trs,
                             di.trades, lim, di.streak, InpMaxConsecLoss), clrSilver); y += lh;
   string whyB, whyS;
   bool okB = Allowed(1, 0, false, TimeCurrent(), whyB);
   bool okS = Allowed(-1, 0, false, TimeCurrent(), whyS);
   string g2;
   if(okB || okS)
      g2 = StringFormat("Today %+.2f$ (lock at -%.0f$)  %s", di.closedNet + di.floating,
                        di.startBal * InpDailyLossPct / 100.0, okB && okS ? "OK" : (okB ? "BUY only" : "SELL only"));
   else
      g2 = "LOCKED: " + whyB;
   Lbl("g2", y, g2, (okB || okS) ? clrLimeGreen : clrTomato);
   ChartRedraw(0);
  }

//+------------------------------------------------------------------+
//| trade buttons: Buy / Sell + size (lot or risk %)                  |
//+------------------------------------------------------------------+
int PanelW()  { return 46 * (InpFontSize - 1) + 20; }
int CtrlTop()
  {
   if(!InpShowPanel) return InpPanelY;
   return InpPanelY + PANEL_ROWS * (InpFontSize + 9) + 12;
  }

string UIKey(string s) { return Prefix() + "UI_" + s; }

double NormVol(double v)
  {
   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   double vmin = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double vmax = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   if(step <= 0) step = 0.01;
   v = MathFloor(v / step + 1e-9) * step;
   if(v < vmin) v = vmin;
   if(v > vmax) v = vmax;
   return NormalizeDouble(v, VolDigits());
  }

// money lost by 1.0 lot if the whole set hits SL (P1 at its SL, plus P2 at its SL when P2 is on)
double WorstLossPerLot(bool buy)
  {
   if(!RefreshDistances()) return 0;
   double dir   = buy ? 1.0 : -1.0;
   double price = buy ? SymbolInfoDouble(_Symbol, SYMBOL_ASK) : SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double p2    = price - dir * g_p2d;
   ENUM_ORDER_TYPE ot = buy ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
   double l1 = 0, l2 = 0;
   bool ok1 = OrderCalcProfit(ot, _Symbol, 1.0, price, price - dir * g_p1sl, l1);
   bool ok2 = !InpUseP2 || OrderCalcProfit(ot, _Symbol, 1.0, p2, p2 - dir * g_p2sl, l2);
   if(ok1 && ok2) return MathAbs(l1) + MathAbs(l2);
   double tv = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
   double ts = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   if(ts <= 0) return 0;
   return tv / ts * (g_p1sl + (InpUseP2 ? g_p2sl : 0));
  }

// lot for the next button trade; 0 = cannot trade (risk too small for min lot)
double CalcLot(bool buy)
  {
   if(g_mode == SIZE_LOT) return NormVol(g_lot);
   double per = WorstLossPerLot(buy);
   if(per <= 0) return 0;
   double money = AccountInfoDouble(ACCOUNT_BALANCE) * g_risk / 100.0;
   double step  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   double vmin  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double lot   = MathFloor(money / per / step + 1e-9) * step;
   if(lot < vmin - 1e-9) return 0;
   if(InpMaxLot > 0 && lot > InpMaxLot) lot = InpMaxLot;     // risk mode never goes above the max lot
   return NormVol(lot);
  }

void Btn(string name, int x, int y, int w, int h, string text, color bgc, color txt, int fs)
  {
   string nm = PANEL + name;
   if(ObjectFind(0, nm) < 0)
     {
      ObjectCreate(0, nm, OBJ_BUTTON, 0, 0, 0);
      ObjectSetInteger(0, nm, OBJPROP_CORNER, CORNER_LEFT_UPPER);
      ObjectSetString(0, nm, OBJPROP_FONT, "Arial Bold");
      ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, nm, OBJPROP_HIDDEN, true);
     }
   ObjectSetInteger(0, nm, OBJPROP_XDISTANCE, x);
   ObjectSetInteger(0, nm, OBJPROP_YDISTANCE, y);
   ObjectSetInteger(0, nm, OBJPROP_XSIZE, w);
   ObjectSetInteger(0, nm, OBJPROP_YSIZE, h);
   ObjectSetInteger(0, nm, OBJPROP_FONTSIZE, fs);
   ObjectSetString(0, nm, OBJPROP_TEXT, text);
   ObjectSetInteger(0, nm, OBJPROP_BGCOLOR, bgc);
   ObjectSetInteger(0, nm, OBJPROP_COLOR, txt);
   ObjectSetInteger(0, nm, OBJPROP_BORDER_COLOR, clrDimGray);
   ObjectSetInteger(0, nm, OBJPROP_STATE, false);
  }

void UpdateControls(bool setValue = false)   // setValue=false keeps what the user is typing
  {
   if(!InpShowButtons) return;
   int x = InpPanelX + 10, y = CtrlTop() + 6;

   if(!InpShowPanel)   // own background when the stats panel is hidden
     {
      string bg = PANEL + "bg2";
      if(ObjectFind(0, bg) < 0)
        {
         ObjectCreate(0, bg, OBJ_RECTANGLE_LABEL, 0, 0, 0);
         ObjectSetInteger(0, bg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
         ObjectSetInteger(0, bg, OBJPROP_BORDER_TYPE, BORDER_FLAT);
         ObjectSetInteger(0, bg, OBJPROP_SELECTABLE, false);
         ObjectSetInteger(0, bg, OBJPROP_HIDDEN, true);
        }
      ObjectSetInteger(0, bg, OBJPROP_XDISTANCE, InpPanelX);
      ObjectSetInteger(0, bg, OBJPROP_YDISTANCE, InpPanelY);
      ObjectSetInteger(0, bg, OBJPROP_XSIZE, PanelW());
      ObjectSetInteger(0, bg, OBJPROP_YSIZE, CTRL_H);
      ObjectSetInteger(0, bg, OBJPROP_BGCOLOR, InpBgColor);
      ObjectSetInteger(0, bg, OBJPROP_COLOR, clrDimGray);
     }

   // row 1: mode buttons + value box
   Btn("b_lot",  x,       y, 70, 24, "Lot",    g_mode == SIZE_LOT  ? clrSteelBlue : C'60,60,66', clrWhite, 9);
   Btn("b_risk", x + 76,  y, 80, 24, "Risk %", g_mode == SIZE_RISK ? clrSteelBlue : C'60,60,66', clrWhite, 9);
   string ed = PANEL + "b_val";
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
      ObjectSetString(0, ed, OBJPROP_TEXT, g_mode == SIZE_LOT ? DoubleToString(g_lot, VolDigits())
                                                             : DoubleToString(g_risk, 2));
   Lbl("b_unit", y + 5, "", InpTextColor);
   ObjectSetInteger(0, PANEL + "b_unit", OBJPROP_XDISTANCE, x + 258);
   ObjectSetString(0, PANEL + "b_unit", OBJPROP_TEXT, g_mode == SIZE_LOT ? "lot" : "% risk");

   // row 2: Sell / Buy
   y += 32;
   int bw = (PanelW() - 30) / 2;
   Btn("b_sell", x,           y, bw, 34, "SELL", C'200,50,50',  clrWhite, 12);
   Btn("b_buy",  x + bw + 10, y, bw, 34, "BUY",  C'30,150,90',  clrWhite, 12);

   // row 3: what will be traded
   y += 42;
   double lot   = CalcLot(true);
   double bal   = AccountInfoDouble(ACCOUNT_BALANCE);
   string info;
   color  ic = InpTextColor;
   if(lot <= 0)
     { info = "Risk too small for the minimum lot"; ic = clrTomato; }
   else
     {
      double worst = lot * WorstLossPerLot(true);
      double pct   = bal > 0 ? 100.0 * worst / bal : 0;
      double step  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
      double vmin  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
      double cv    = MathFloor(lot * InpClosePercent / 100.0 / step + 1e-9) * step;
      bool   split = (cv >= vmin - 1e-9 && lot - cv >= vmin - 1e-9);
      info = StringFormat("Lot %s%s | worst -%.2f$ (%.1f%%)%s", DoubleToString(lot, VolDigits()),
                          InpUseP2 ? " x2" : "", worst, pct, split ? "" : " | no split");
      if(pct > 5) ic = clrTomato; else if(pct > 2) ic = clrOrange; else ic = clrLimeGreen;
     }
   Lbl("b_info", y, info, ic);
   ChartRedraw(0);
  }

bool P1OK()
  {
   uint rc = tradeP1.ResultRetcode();
   return (rc == TRADE_RETCODE_DONE || rc == TRADE_RETCODE_PLACED || rc == TRADE_RETCODE_DONE_PARTIAL);
  }

void OpenP1(bool buy)
  {
   string blocked = TradingBlockedBy();
   if(blocked != "") { Alert("Not opened: " + blocked); return; }
   double lot = CalcLot(buy);
   if(lot <= 0) { Alert("Risk % is too small for the minimum lot. Raise the risk or use Lot mode."); return; }
   if(!RefreshDistances()) { Alert("Distances not ready yet (no M15 history). Try again in a moment."); return; }
   string why;
   if(!Allowed(buy ? 1 : -1, lot, false, TimeCurrent(), why)) { Alert("Not opened: " + why); return; }

   double dir   = buy ? 1.0 : -1.0;
   double price = buy ? SymbolInfoDouble(_Symbol, SYMBOL_ASK) : SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double sl    = (InpP1StartSL || !InpUseP2) ? NP(price - dir * g_p1sl) : 0;

   bool sent = buy ? tradeP1.Buy(lot, _Symbol, 0, sl, 0, "GHE P1")
                   : tradeP1.Sell(lot, _Symbol, 0, sl, 0, "GHE P1");
   if(!sent || !P1OK())
     {
      Alert(StringFormat("%s failed: %u %s", buy ? "Buy" : "Sell", tradeP1.ResultRetcode(), tradeP1.ResultRetcodeDescription()));
      return;
     }
   Log(StringFormat("Button %s %s lot, SL %s", buy ? "BUY" : "SELL", DoubleToString(lot, VolDigits()),
                    sl > 0 ? DoubleToString(sl, _Digits) : "none"));
   Manage();   // place P2 right away
  }

void SaveUI()
  {
   GlobalVariableSet(UIKey("mode"), g_mode);
   GlobalVariableSet(UIKey("lot"),  g_lot);
   GlobalVariableSet(UIKey("risk"), g_risk);
  }

void LoadUI()
  {
   g_mode = GlobalVariableCheck(UIKey("mode")) ? (int)GlobalVariableGet(UIKey("mode")) : (int)InpSizeMode;
   g_lot  = GlobalVariableCheck(UIKey("lot"))  ? GlobalVariableGet(UIKey("lot"))  : InpDefaultLot;
   g_risk = GlobalVariableCheck(UIKey("risk")) ? GlobalVariableGet(UIKey("risk")) : InpDefaultRisk;
  }

void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
  {
   if(!InpShowButtons) return;
   if(id == CHARTEVENT_OBJECT_CLICK)
     {
      if(sparam == PANEL + "b_buy")       { ObjectSetInteger(0, sparam, OBJPROP_STATE, false); OpenP1(true); }
      else if(sparam == PANEL + "b_sell") { ObjectSetInteger(0, sparam, OBJPROP_STATE, false); OpenP1(false); }
      else if(sparam == PANEL + "b_lot")  { g_mode = SIZE_LOT;  SaveUI(); }
      else if(sparam == PANEL + "b_risk") { g_mode = SIZE_RISK; SaveUI(); }
      else return;
      UpdateControls(true);
     }
   else if(id == CHARTEVENT_OBJECT_ENDEDIT && sparam == PANEL + "b_val")
     {
      string s = ObjectGetString(0, sparam, OBJPROP_TEXT);
      StringReplace(s, ",", ".");
      double v = StringToDouble(s);
      if(g_mode == SIZE_LOT)
        {
         if(v <= 0) Alert("Enter a lot size above 0");
         else if(InpMaxLot > 0 && v > InpMaxLot + 1e-9)
            Alert(StringFormat("Lot %.2f is above the max %.2f - not accepted", v, InpMaxLot));
         else g_lot = NormVol(v);
        }
      else
        {
         if(v > 0 && v <= 20) g_risk = v;
         else Alert("Enter a risk between 0.1 and 20 %");
        }
      SaveUI();
      UpdateControls(true);
     }
  }

//+------------------------------------------------------------------+
//| events                                                           |
//+------------------------------------------------------------------+
int OnInit()
  {
   if((ENUM_ACCOUNT_MARGIN_MODE)AccountInfoInteger(ACCOUNT_MARGIN_MODE) != ACCOUNT_MARGIN_MODE_RETAIL_HEDGING)
     {
      Alert("Gold Hedge Manager needs a HEDGING account. This account is netting.");
      return INIT_FAILED;
     }
   if(InpPipSize <= 0 || InpP2Distance <= 0 || InpP2StopLoss <= 0 || InpP1StopLoss <= 0 ||
      InpP2DistanceC <= 0 || InpP2StopLossC <= 0 || InpP1StopLossC <= 0 || InpTriggerC <= 0 || InpCandleBars < 100 ||
      InpClosePercent <= 0 || InpClosePercent >= 100)
     {
      Alert("Gold Hedge Manager: check the inputs (distances > 0, close % between 0 and 100).");
      return INIT_PARAMETERS_INCORRECT;
     }
   trade.SetExpertMagicNumber(InpMagic);
   trade.SetDeviationInPoints(InpSlippagePts);
   trade.SetTypeFillingBySymbol(_Symbol);
   trade.SetAsyncMode(false);

   tradeP1.SetExpertMagicNumber(0);            // same as a manual trade
   tradeP1.SetDeviationInPoints(InpSlippagePts);
   tradeP1.SetTypeFillingBySymbol(_Symbol);
   tradeP1.SetAsyncMode(false);

   g_hFast = iMA(_Symbol, PERIOD_H4, 50,  0, MODE_EMA, PRICE_CLOSE);
   g_hSlow = iMA(_Symbol, PERIOD_H4, 200, 0, MODE_EMA, PRICE_CLOSE);
   if(InpTrendFilter && (g_hFast == INVALID_HANDLE || g_hSlow == INVALID_HANDLE))
     { Alert("Cannot create the H4 trend indicators"); return INIT_FAILED; }
   RefreshDistances();

   g_start = TimeCurrent();
   LoadManaged();
   LoadUI();
   EventSetTimer(1);
   Manage();
   DrawPanel();
   UpdateControls(true);
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   if(g_hFast != INVALID_HANDLE) IndicatorRelease(g_hFast);
   if(g_hSlow != INVALID_HANDLE) IndicatorRelease(g_hSlow);
   ObjectsDeleteAll(0, PANEL);
   ChartRedraw(0);
  }

void OnTick()
  {
   Manage();
  }

void OnTimer()
  {
   Manage();                                  // also works when no ticks arrive
   if(++g_timerTick >= 2) { g_timerTick = 0; DrawPanel(); UpdateControls(); }
  }
//+------------------------------------------------------------------+
