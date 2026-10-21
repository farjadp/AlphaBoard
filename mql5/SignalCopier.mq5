//+------------------------------------------------------------------+
//|                                                SignalCopier.mq5 |
//|  AlphaBoard Signal Desk (P12): executes the signals written in   |
//|  Admin -> Signals. Polls GET /api/mt5/signals/next every few     |
//|  seconds with this terminal's token, opens one position per      |
//|  target (shared stop, own TP, all set at the broker) and reports |
//|  every fill, target, stop and close back to AlphaBoard.          |
//|                                                                   |
//|  Safety: dry run by default (opens nothing, reports DRY_RUN);    |
//|  refuses a REAL account unless InpAllowReal; risk capped at       |
//|  InpRiskCapPct and InpMaxLot; never rounds risk up to the min     |
//|  lot; never opens the same leg twice (order comment ab:id:leg).   |
//|  Money management (whole account, broker day, like               |
//|  GoldHedgeManager): daily loss lock, stop after N losing trades   |
//|  in a row, cooldown after a loss, max signals open at once. The   |
//|  legs of one signal count as one trade. A blocked signal is       |
//|  reported as REJECTED with the reason.                            |
//|                                                                   |
//|  Setup: Tools -> Options -> Expert Advisors -> allow WebRequest   |
//|  for InpBaseUrl. Attach to ONE chart (any symbol). Hedging or     |
//|  netting accounts both work; each leg is its own position on a    |
//|  hedging account.                                                  |
//+------------------------------------------------------------------+
#property copyright "AlphaBoard"
#property version   "1.10"
#property description "Executes AlphaBoard Signal Desk signals: one position per target, broker-side SL/TP, reports back"

#include <Trade/Trade.mqh>

//--- inputs
input group "=== Connection ==="
input string InpBaseUrl     = "https://example.up.railway.app"; // AlphaBoard address (also allow it for WebRequest)
input string InpToken       = "";      // Terminal token from Admin -> Signals
input int    InpPollSec     = 3;       // Poll every N seconds

input group "=== Safety ==="
input bool   InpDryRun      = true;    // Dry run: log and report, open nothing
input bool   InpAllowReal   = false;   // Allow a REAL-money account
input double InpRiskCapPct  = 1.0;     // Max risk per signal, % of balance
input double InpMaxLot      = 0.05;    // Max total lot per signal (all legs)

input group "=== Money management (whole account, broker day) ==="
input double InpDailyLossPct   = 2.0;  // Daily loss lock, % of balance at day start (0 = off)
input int    InpMaxConsecLoss  = 2;    // No new signals today after N losing trades in a row (0 = off)
input int    InpCooldownMin    = 30;   // No new signal for N minutes after a losing trade (0 = off)
input int    InpMaxOpenSignals = 2;    // Max signals open at once (0 = off)

input group "=== Management ==="
input bool   InpBEAfterTP1  = true;    // After TP1, move the other legs' stop to entry
input ulong  InpMagic       = 880900;  // Magic number (GoldHedgeManager uses 880801)
input int    InpSlippagePts = 30;      // Max deviation for market orders (points)

//--- constants
#define HEARTBEAT_SEC  30
#define HTTP_TIMEOUT   5000
#define MAX_QUEUE      50
#define COMMENT_PREFIX "ab:"

CTrade   trade;
string   g_base;
datetime g_lastBeat = 0;
bool     g_warnedUrl = false;

//--- report queue (retried on every timer tick until the server accepts it)
string   g_qPath[];
string   g_qBody[];

//+------------------------------------------------------------------+
//| helpers                                                           |
//+------------------------------------------------------------------+
string UrlEncode(const string s)
  {
   uchar bytes[];
   int n = StringToCharArray(s, bytes, 0, WHOLE_ARRAY, CP_UTF8) - 1; // drop the terminating 0
   string out = "";
   for(int i = 0; i < n; i++)
     {
      uchar c = bytes[i];
      bool plain = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' || c == '~';
      out += plain ? CharToString(c) : StringFormat("%%%02X", c);
     }
   return out;
  }

int StepDigits(const double step)
  {
   int d = 0;
   double s = step;
   while(d < 8 && MathAbs(s - MathRound(s)) > 1e-9) { s *= 10; d++; }
   return d;
  }

string Px(const string sym, const double price) { return DoubleToString(price, (int)SymbolInfoInteger(sym, SYMBOL_DIGITS)); }

string Vol(const string sym, const double v) { return DoubleToString(v, StepDigits(SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP))); }

double FloorTo(const double v, const double step) { return step > 0 ? MathFloor(v / step + 1e-9) * step : v; }

string LegComment(const string id, const int leg) { return COMMENT_PREFIX + id + ":" + IntegerToString(leg); }

//--- "ab:<id>:<leg>" -> id and leg; false for anything else
bool ParseComment(const string c, string &id, int &leg)
  {
   if(StringFind(c, COMMENT_PREFIX) != 0) return false;
   string parts[];
   if(StringSplit(StringSubstr(c, StringLen(COMMENT_PREFIX)), ':', parts) != 2) return false;
   id = parts[0];
   leg = (int)StringToInteger(parts[1]);
   return StringLen(id) > 0 && leg > 0;
  }

//+------------------------------------------------------------------+
//| HTTP                                                              |
//+------------------------------------------------------------------+
//--- returns the HTTP status (or -1 on a terminal error) and the body text
int Http(const string method, const string path, const string body, string &response)
  {
   char data[], result[];
   string headers = "Authorization: Bearer " + InpToken + "\r\n";
   if(method == "POST")
     {
      headers += "Content-Type: application/x-www-form-urlencoded\r\n";
      int n = StringToCharArray(body, data, 0, WHOLE_ARRAY, CP_UTF8);
      ArrayResize(data, MathMax(n - 1, 0)); // no terminating 0 in the request body
     }
   string resultHeaders;
   ResetLastError();
   int status = WebRequest(method, g_base + path, headers, HTTP_TIMEOUT, data, result, resultHeaders);
   response = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
   if(status == -1)
     {
      int err = GetLastError();
      if(err == 4014 && !g_warnedUrl)
        {
         Print("SignalCopier: WebRequest is not allowed for ", g_base, ". Tools -> Options -> Expert Advisors -> tick 'Allow WebRequest for listed URL' and add ", g_base);
         g_warnedUrl = true;
        }
      else if(err != 4014)
         Print("SignalCopier: ", method, " ", path, " failed, error ", err);
     }
   return status;
  }

void Report(const string id, const string body)
  {
   int n = ArraySize(g_qPath);
   if(n >= MAX_QUEUE)
     {
      Print("SignalCopier: report queue full, dropping ", body, " for ", id);
      return;
     }
   ArrayResize(g_qPath, n + 1);
   ArrayResize(g_qBody, n + 1);
   g_qPath[n] = "/api/mt5/signals/" + id + "/report";
   g_qBody[n] = body;
  }

void FlushReports()
  {
   int i = 0;
   while(i < ArraySize(g_qPath))
     {
      string resp;
      int status = Http("POST", g_qPath[i], g_qBody[i], resp);
      if(status == -1 || status >= 500 || status == 429) { i++; continue; } // keep for the next tick
      if(status >= 400) Print("SignalCopier: report refused (HTTP ", status, "): ", g_qBody[i], " ", resp);
      for(int j = i; j < ArraySize(g_qPath) - 1; j++) { g_qPath[j] = g_qPath[j + 1]; g_qBody[j] = g_qBody[j + 1]; }
      ArrayResize(g_qPath, ArraySize(g_qPath) - 1);
      ArrayResize(g_qBody, ArraySize(g_qBody) - 1);
     }
  }

void Heartbeat()
  {
   long mode = AccountInfoInteger(ACCOUNT_TRADE_MODE);
   string m = mode == ACCOUNT_TRADE_MODE_REAL ? "REAL" : mode == ACCOUNT_TRADE_MODE_CONTEST ? "CONTEST" : "DEMO";
   string symbols = "";
   int total = SymbolsTotal(true);
   for(int i = 0; i < total; i++) symbols += (i ? "," : "") + SymbolName(i, true);
   string body = "login=" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN))
               + "&server=" + UrlEncode(AccountInfoString(ACCOUNT_SERVER))
               + "&mode=" + m
               + "&balance=" + DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE), 2)
               + "&currency=" + UrlEncode(AccountInfoString(ACCOUNT_CURRENCY))
               + "&symbols=" + UrlEncode(symbols);
   string resp;
   int status = Http("POST", "/api/mt5/heartbeat", body, resp);
   if(status == 401) Print("SignalCopier: the token was refused. Create a new one in Admin -> Signals.");
   g_lastBeat = TimeCurrent();
  }

//+------------------------------------------------------------------+
//| positions                                                         |
//+------------------------------------------------------------------+
//--- a leg is already there when an open position or any past deal carries its comment
bool LegExists(const string comment)
  {
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      if(t > 0 && PositionGetInteger(POSITION_MAGIC) == (long)InpMagic && PositionGetString(POSITION_COMMENT) == comment) return true;
     }
   if(!HistorySelect(TimeCurrent() - 7 * 86400, TimeCurrent() + 86400)) return false;
   for(int i = HistoryDealsTotal() - 1; i >= 0; i--)
     {
      ulong d = HistoryDealGetTicket(i);
      if(HistoryDealGetInteger(d, DEAL_MAGIC) == (long)InpMagic && HistoryDealGetInteger(d, DEAL_ENTRY) == DEAL_ENTRY_IN && HistoryDealGetString(d, DEAL_COMMENT) == comment) return true;
     }
   return false;
  }

//--- the signal id and leg of an open position (by its own comment, or its opening deal's)
bool PositionLeg(const ulong ticket, string &id, int &leg)
  {
   if(!PositionSelectByTicket(ticket)) return false;
   if(PositionGetInteger(POSITION_MAGIC) != (long)InpMagic) return false;
   return ParseComment(PositionGetString(POSITION_COMMENT), id, leg);
  }

//--- the signal id and leg of a closed position, from its opening deal
bool HistoryLeg(const ulong positionId, string &id, int &leg, double &openPrice)
  {
   if(!HistorySelectByPosition(positionId)) return false;
   for(int i = 0; i < HistoryDealsTotal(); i++)
     {
      ulong d = HistoryDealGetTicket(i);
      if(HistoryDealGetInteger(d, DEAL_ENTRY) != DEAL_ENTRY_IN) continue;
      openPrice = HistoryDealGetDouble(d, DEAL_PRICE);
      return ParseComment(HistoryDealGetString(d, DEAL_COMMENT), id, leg);
     }
   return false;
  }

//--- moves every open leg of a signal (except skipLeg) to its entry; true when at least one moved or already was there
bool Breakeven(const string id, const int skipLeg)
  {
   bool any = false;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      string pid; int leg;
      if(!PositionLeg(t, pid, leg) || pid != id || leg == skipLeg) continue;
      string sym = PositionGetString(POSITION_SYMBOL);
      double open = PositionGetDouble(POSITION_PRICE_OPEN);
      double sl = PositionGetDouble(POSITION_SL);
      double tp = PositionGetDouble(POSITION_TP);
      bool buy = PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY;
      // never loosen a stop: only move it when entry is better than where it is
      if(sl > 0 && ((buy && sl >= open) || (!buy && sl <= open))) { any = true; continue; }
      if(InpDryRun) { Print("SignalCopier [dry run]: would move ", sym, " leg ", leg, " stop to ", Px(sym, open)); any = true; continue; }
      if(trade.PositionModify(t, open, tp)) any = true;
      else Print("SignalCopier: stop to entry failed on ", sym, " leg ", leg, ": ", trade.ResultRetcodeDescription());
     }
   return any;
  }

//+------------------------------------------------------------------+
//| money management                                                  |
//+------------------------------------------------------------------+
datetime DayStart()
  {
   MqlDateTime d;
   TimeToStruct(TimeCurrent(), d);
   d.hour = 0; d.min = 0; d.sec = 0;
   return StructToTime(d);
  }

//--- index of key in keys[], appending it when new
int KeyIndex(string &keys[], double &net[], datetime &last[], const string key)
  {
   int n = ArraySize(keys);
   for(int i = 0; i < n; i++) if(keys[i] == key) return i;
   ArrayResize(keys, n + 1); ArrayResize(net, n + 1); ArrayResize(last, n + 1);
   keys[n] = key; net[n] = 0; last[n] = 0;
   return n;
  }

//--- today's closed trades (a signal's legs are one trade), closed P/L, floating P/L of today's positions
void TodayTrades(string &keys[], double &net[], datetime &last[], double &closedNet, double &floating)
  {
   ArrayResize(keys, 0); ArrayResize(net, 0); ArrayResize(last, 0);
   closedNet = 0; floating = 0;
   datetime from = DayStart();
   if(HistorySelect(from, TimeCurrent() + 60))
     {
      int nd = HistoryDealsTotal();
      // the signal id of each copier position opened today, from its opening deal's comment
      ulong  inPos[];
      string inSig[];
      for(int i = 0; i < nd; i++)
        {
         ulong t = HistoryDealGetTicket(i);
         if(HistoryDealGetInteger(t, DEAL_ENTRY) != DEAL_ENTRY_IN || HistoryDealGetInteger(t, DEAL_MAGIC) != (long)InpMagic) continue;
         string id; int leg;
         if(!ParseComment(HistoryDealGetString(t, DEAL_COMMENT), id, leg)) continue;
         int k = ArraySize(inPos);
         ArrayResize(inPos, k + 1); ArrayResize(inSig, k + 1);
         inPos[k] = (ulong)HistoryDealGetInteger(t, DEAL_POSITION_ID); inSig[k] = id;
        }
      for(int i = 0; i < nd; i++)
        {
         ulong t = HistoryDealGetTicket(i);
         long type = HistoryDealGetInteger(t, DEAL_TYPE);
         if(type != DEAL_TYPE_BUY && type != DEAL_TYPE_SELL) continue;
         double v = HistoryDealGetDouble(t, DEAL_PROFIT) + HistoryDealGetDouble(t, DEAL_SWAP)
                  + HistoryDealGetDouble(t, DEAL_COMMISSION) + HistoryDealGetDouble(t, DEAL_FEE);
         closedNet += v;
         long entry = HistoryDealGetInteger(t, DEAL_ENTRY);
         if(entry != DEAL_ENTRY_OUT && entry != DEAL_ENTRY_OUT_BY) continue;
         ulong pos = (ulong)HistoryDealGetInteger(t, DEAL_POSITION_ID);
         string key = "p" + IntegerToString((long)pos);
         for(int k = 0; k < ArraySize(inPos); k++) if(inPos[k] == pos) { key = "s" + inSig[k]; break; }
         int idx = KeyIndex(keys, net, last, key);
         net[idx] += v;
         datetime tm = (datetime)HistoryDealGetInteger(t, DEAL_TIME);
         if(tm > last[idx]) last[idx] = tm;
        }
     }
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      if(PositionGetTicket(i) == 0) continue;
      if((datetime)PositionGetInteger(POSITION_TIME) < from) continue; // older positions are not today's loss
      floating += PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
     }
  }

int OpenSignalCount()
  {
   string ids[];
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      string id; int leg;
      if(!PositionLeg(t, id, leg)) continue;
      bool seen = false;
      for(int k = 0; k < ArraySize(ids); k++) if(ids[k] == id) { seen = true; break; }
      if(!seen) { int n = ArraySize(ids); ArrayResize(ids, n + 1); ids[n] = id; }
     }
   return ArraySize(ids);
  }

//--- "" when a new signal may open, else the reason it may not
string Blocked()
  {
   if(InpMaxOpenSignals > 0)
     {
      int open = OpenSignalCount();
      if(open >= InpMaxOpenSignals) return StringFormat("%d signals already open (max %d)", open, InpMaxOpenSignals);
     }
   string keys[]; double net[]; datetime last[]; double closedNet, floating;
   TodayTrades(keys, net, last, closedNet, floating);
   string ccy = AccountInfoString(ACCOUNT_CURRENCY);
   double startBal = AccountInfoDouble(ACCOUNT_BALANCE) - closedNet;
   if(InpDailyLossPct > 0 && startBal > 0)
     {
      double limit = startBal * InpDailyLossPct / 100.0;
      if(closedNet + floating <= -limit)
         return StringFormat("daily loss lock: today %.2f %s, limit -%.2f %s (%.1f%%); no new signals until tomorrow", closedNet + floating, ccy, limit, ccy, InpDailyLossPct);
     }
   // trades in closing order; the streak is the run of losses at the end
   int n = ArraySize(keys);
   int order[];
   ArrayResize(order, n);
   for(int i = 0; i < n; i++) order[i] = i;
   for(int i = 1; i < n; i++) { int v = order[i], j = i - 1; while(j >= 0 && last[order[j]] > last[v]) { order[j + 1] = order[j]; j--; } order[j + 1] = v; }
   int streak = 0;
   datetime lastLoss = 0;
   for(int i = 0; i < n; i++)
     {
      int k = order[i];
      if(net[k] < 0) { streak++; if(last[k] > lastLoss) lastLoss = last[k]; }
      else streak = 0;
     }
   if(InpMaxConsecLoss > 0 && streak >= InpMaxConsecLoss)
      return StringFormat("%d losing trades in a row today; no new signals until tomorrow", streak);
   if(InpCooldownMin > 0 && lastLoss > 0 && TimeCurrent() - lastLoss < InpCooldownMin * 60)
      return StringFormat("cooldown after a loss: %d min left", (int)((lastLoss + InpCooldownMin * 60 - TimeCurrent()) / 60) + 1);
   return "";
  }

//+------------------------------------------------------------------+
//| jobs                                                              |
//+------------------------------------------------------------------+
void Reject(const string id, const string reason)
  {
   Print("SignalCopier: signal ", id, " rejected: ", reason);
   Report(id, "event=REJECTED&reason=" + UrlEncode(reason));
  }

//--- OPEN|<id>|<symbol>|<BUY|SELL>|<entry|->|<stop>|<maxDev|->|<riskPct>|<tp1,tp2,..|->
void OpenSignal(string &f[])
  {
   string id = f[1], sym = f[2];
   bool buy = f[3] == "BUY";
   bool hasEntry = f[4] != "-";
   double entry = hasEntry ? StringToDouble(f[4]) : 0;
   double stop = StringToDouble(f[5]);
   double maxDev = f[6] != "-" ? StringToDouble(f[6]) : 0;
   double riskPct = MathMin(StringToDouble(f[7]), InpRiskCapPct);
   double tps[];
   ArrayResize(tps, 0);
   if(f[8] != "-")
     {
      string t[];
      int n = StringSplit(f[8], ',', t);
      ArrayResize(tps, n);
      for(int i = 0; i < n; i++) tps[i] = StringToDouble(t[i]);
     }

   string why = Blocked();
   if(why != "") { Reject(id, why); return; }
   if(!SymbolSelect(sym, true)) { Reject(id, sym + " is not available in this terminal"); return; }
   MqlTick tick;
   if(!SymbolInfoTick(sym, tick) || tick.ask <= 0 || tick.bid <= 0) { Reject(id, "no price for " + sym); return; }
   double price = buy ? tick.ask : tick.bid;

   // price checks
   if((buy && price <= stop) || (!buy && price >= stop)) { Reject(id, "price beyond stop (" + Px(sym, price) + ")"); return; }
   if(hasEntry)
     {
      double dev = maxDev > 0 ? maxDev : MathAbs(entry - stop) * 0.25;
      if(MathAbs(price - entry) > dev) { Reject(id, "price moved (" + Px(sym, price) + " vs entry " + Px(sym, entry) + ")"); return; }
     }

   // volume from risk: never rounded up
   double tickSize = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_SIZE);
   double tickLoss = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_VALUE_LOSS);
   if(tickLoss <= 0) tickLoss = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_VALUE);
   double step = SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP);
   double minLot = SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN);
   double maxLot = SymbolInfoDouble(sym, SYMBOL_VOLUME_MAX);
   if(tickSize <= 0 || tickLoss <= 0 || step <= 0) { Reject(id, "symbol specification missing for " + sym); return; }
   double riskMoney = AccountInfoDouble(ACCOUNT_BALANCE) * riskPct / 100.0;
   double lossPerLot = MathAbs(price - stop) / tickSize * tickLoss;
   double lots = FloorTo(MathMin(MathMin(riskMoney / lossPerLot, InpMaxLot), maxLot), step);
   if(lots < minLot - 1e-9) { Reject(id, "volume below min lot (risk allows " + DoubleToString(riskMoney / lossPerLot, 4) + ", min " + Vol(sym, minLot) + ")"); return; }

   // legs: one per target, fewer when the volume cannot be split; the first targets are kept
   int n = MathMax(1, ArraySize(tps));
   while(n > 1 && FloorTo(lots / n, step) < minLot - 1e-9) n--;
   double per = FloorTo(lots / n, step);
   double first = FloorTo(lots - per * (n - 1), step);

   string plan = "lots=" + Vol(sym, lots) + " legs=" + IntegerToString(n) + " price=" + Px(sym, price) + " stop=" + Px(sym, stop);
   for(int i = 0; i < n; i++) plan += " tp" + IntegerToString(i + 1) + "=" + (i < ArraySize(tps) ? Px(sym, tps[i]) : "none");
   if(InpDryRun)
     {
      Print("SignalCopier [dry run]: ", sym, " ", f[3], " ", plan);
      Report(id, "event=DRY_RUN&reason=" + UrlEncode(plan));
      return;
     }

   trade.SetTypeFillingBySymbol(sym);
   int opened = 0;
   for(int leg = 1; leg <= n; leg++)
     {
      string comment = LegComment(id, leg);
      if(LegExists(comment)) { Print("SignalCopier: ", comment, " already exists, not opened again"); opened++; continue; }
      double vol = leg == 1 ? first : per;
      double tp = leg - 1 < ArraySize(tps) ? tps[leg - 1] : 0;
      bool ok = buy ? trade.Buy(vol, sym, 0, stop, tp, comment) : trade.Sell(vol, sym, 0, stop, tp, comment);
      uint rc = trade.ResultRetcode();
      if(!ok || (rc != TRADE_RETCODE_DONE && rc != TRADE_RETCODE_DONE_PARTIAL && rc != TRADE_RETCODE_PLACED))
        {
         Reject(id, "leg " + IntegerToString(leg) + ": " + trade.ResultRetcodeDescription() + " (" + IntegerToString(rc) + ")");
         break; // never chase: what is open stays open, the rest is not tried
        }
      double fill = trade.ResultPrice() > 0 ? trade.ResultPrice() : price;
      ulong ticket = trade.ResultOrder(); // on a hedging account the position ticket equals the opening order ticket
      Report(id, "event=FILLED&leg=" + IntegerToString(leg) + "&ticket=" + IntegerToString((long)ticket)
             + "&volume=" + Vol(sym, trade.ResultVolume() > 0 ? trade.ResultVolume() : vol) + "&price=" + Px(sym, fill)
             + (tp > 0 ? "&tp=" + Px(sym, tp) : ""));
      opened++;
     }
   Print("SignalCopier: ", sym, " ", f[3], " opened ", opened, "/", n, " legs (", plan, ")");
  }

//--- CMD|<id>|<CLOSE_ALL|BREAKEVEN>
void Command(string &f[])
  {
   string id = f[1];
   if(f[2] == "BREAKEVEN")
     {
      if(Breakeven(id, 0)) Report(id, "event=BE&price=1"); // the server needs a positive price but does not use it for BE
      return;
     }
   if(f[2] != "CLOSE_ALL") { Print("SignalCopier: unknown command ", f[2]); return; }
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      string pid; int leg;
      if(!PositionLeg(t, pid, leg) || pid != id) continue;
      if(InpDryRun) { Print("SignalCopier [dry run]: would close leg ", leg, " of ", id); continue; }
      if(!trade.PositionClose(t)) Print("SignalCopier: close failed on leg ", leg, ": ", trade.ResultRetcodeDescription());
      // the CLOSED report comes from OnTradeTransaction
     }
  }

void Poll()
  {
   string resp;
   int status = Http("GET", "/api/mt5/signals/next", "", resp);
   if(status == 401) { Print("SignalCopier: the token was refused. Create a new one in Admin -> Signals."); return; }
   if(status != 200 || StringLen(resp) == 0) return;
   string lines[];
   int n = StringSplit(resp, '\n', lines);
   for(int i = 0; i < n; i++)
     {
      string f[];
      int k = StringSplit(lines[i], '|', f);
      if(k == 9 && f[0] == "OPEN") OpenSignal(f);
      else if(k == 3 && f[0] == "CMD") Command(f);
      else if(StringLen(lines[i]) > 0) Print("SignalCopier: ignored line ", lines[i]);
     }
  }

//+------------------------------------------------------------------+
//| events                                                            |
//+------------------------------------------------------------------+
int OnInit()
  {
   if(StringLen(InpToken) < 20) { Print("SignalCopier: set InpToken (Admin -> Signals -> New terminal)."); return INIT_PARAMETERS_INCORRECT; }
   g_base = InpBaseUrl;
   while(StringLen(g_base) > 0 && StringGetCharacter(g_base, StringLen(g_base) - 1) == '/') g_base = StringSubstr(g_base, 0, StringLen(g_base) - 1);
   if(StringFind(g_base, "https://") != 0 && StringFind(g_base, "http://") != 0) { Print("SignalCopier: InpBaseUrl must start with https://"); return INIT_PARAMETERS_INCORRECT; }
   if(AccountInfoInteger(ACCOUNT_TRADE_MODE) == ACCOUNT_TRADE_MODE_REAL && !InpAllowReal)
     {
      Print("SignalCopier: this is a REAL-money account and InpAllowReal is false. Not starting.");
      return INIT_FAILED;
     }
   trade.SetExpertMagicNumber(InpMagic);
   trade.SetDeviationInPoints(InpSlippagePts);
   ArrayResize(g_qPath, 0);
   ArrayResize(g_qBody, 0);
   EventSetTimer(MathMax(1, InpPollSec));
   Print("SignalCopier 1.10 started: ", g_base, InpDryRun ? " [DRY RUN - opens nothing]" : " [LIVE]",
         " account ", AccountInfoInteger(ACCOUNT_LOGIN), " risk cap ", DoubleToString(InpRiskCapPct, 2), "% max lot ", DoubleToString(InpMaxLot, 2),
         " | daily lock ", DoubleToString(InpDailyLossPct, 1), "% stop after ", InpMaxConsecLoss, " losses cooldown ", InpCooldownMin, "m max open ", InpMaxOpenSignals);
   Heartbeat();
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   FlushReports();
  }

void OnTimer()
  {
   if(!TerminalInfoInteger(TERMINAL_CONNECTED)) return;
   if(TimeCurrent() - g_lastBeat >= HEARTBEAT_SEC) Heartbeat();
   FlushReports();
   if(!InpDryRun && (!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) || !MQLInfoInteger(MQL_TRADE_ALLOWED)))
     {
      static datetime warned = 0;
      if(TimeCurrent() - warned > 300) { Print("SignalCopier: Algo Trading is off; not taking signals until it is on."); warned = TimeCurrent(); }
      return; // don't claim jobs we cannot execute: they would end up UNKNOWN
     }
   Poll();
   FlushReports();
  }

//--- a leg closed: TP, SL or anything else (manual / Close all) -> report; TP1 moves the rest to entry
void OnTradeTransaction(const MqlTradeTransaction &trans, const MqlTradeRequest &request, const MqlTradeResult &result)
  {
   if(trans.type != TRADE_TRANSACTION_DEAL_ADD) return;
   if(!HistoryDealSelect(trans.deal)) return;
   if(HistoryDealGetInteger(trans.deal, DEAL_MAGIC) != (long)InpMagic) return;
   long entry = HistoryDealGetInteger(trans.deal, DEAL_ENTRY);
   if(entry != DEAL_ENTRY_OUT && entry != DEAL_ENTRY_OUT_BY) return;
   ulong positionId = (ulong)HistoryDealGetInteger(trans.deal, DEAL_POSITION_ID);
   if(PositionSelectByTicket(positionId)) return; // partly closed: report only the full close
   long reason = HistoryDealGetInteger(trans.deal, DEAL_REASON);
   double price = HistoryDealGetDouble(trans.deal, DEAL_PRICE);
   string sym = HistoryDealGetString(trans.deal, DEAL_SYMBOL);
   string id; int leg; double openPrice;
   if(!HistoryLeg(positionId, id, leg, openPrice)) return;

   string ev = reason == DEAL_REASON_TP ? "TP" : reason == DEAL_REASON_SL ? "SL" : "CLOSED";
   Report(id, "event=" + ev + "&leg=" + IntegerToString(leg) + "&price=" + Px(sym, price));
   if(ev == "TP" && leg == 1 && InpBEAfterTP1 && Breakeven(id, 1))
      Report(id, "event=BE&price=" + Px(sym, openPrice));
  }
//+------------------------------------------------------------------+
