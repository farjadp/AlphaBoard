//+------------------------------------------------------------------+
//| ExportM1.mq5 - writes 12 months of M1 bars to MQL5/Files as CSV  |
//| One file per symbol: M1_<symbol>.csv  (time is UTC)              |
//+------------------------------------------------------------------+
#property script_show_inputs
#property version "1.00"

input string Symbols = "XAUUSD,GBPNZD,EURUSD,EURGBP"; // base names; broker suffix is found automatically
input int    Months  = 12;

string FindSymbol(const string base)
  {
   if(SymbolSelect(base, true)) return base;
   for(int i = 0; i < SymbolsTotal(false); i++)
     {
      string s = SymbolName(i, false);
      if(StringFind(s, base) == 0) { SymbolSelect(s, true); return s; }
     }
   return "";
  }

void OnStart()
  {
   long offset = (long)(TimeTradeServer() - TimeGMT());   // server minus UTC, seconds
   datetime to   = TimeCurrent();
   datetime from = to - (datetime)((long)Months * 31 * 86400);
   string parts[];
   int n = StringSplit(Symbols, ',', parts);
   for(int k = 0; k < n; k++)
     {
      string base = parts[k];
      StringTrimLeft(base); StringTrimRight(base);
      string sym = FindSymbol(base);
      if(sym == "") { Print("[EXP] not found: ", base); continue; }
      MqlRates r[];
      int got = -1;
      for(int attempt = 0; attempt < 30 && got <= 0; attempt++)   // history may need a moment to load
        {
         got = CopyRates(sym, PERIOD_M1, from, to, r);
         if(got <= 0) Sleep(1000);
        }
      if(got <= 0) { Print("[EXP] no data for ", sym, " err ", GetLastError()); continue; }
      int h = FileOpen("M1_" + base + ".csv", FILE_WRITE | FILE_ANSI | FILE_TXT);
      if(h == INVALID_HANDLE) { Print("[EXP] cannot write file for ", sym); continue; }
      FileWriteString(h, "utc,open,high,low,close,spread_points,point,symbol=" + sym + "\n");
      for(int i = 0; i < got; i++)
         FileWriteString(h, StringFormat("%I64d,%.6f,%.6f,%.6f,%.6f,%d,%.6f\n",
                         (long)r[i].time - offset, r[i].open, r[i].high, r[i].low, r[i].close,
                         r[i].spread, SymbolInfoDouble(sym, SYMBOL_POINT)));
      FileClose(h);
      PrintFormat("[EXP] %s: %d bars, %s .. %s", sym, got,
                  TimeToString(r[0].time), TimeToString(r[got - 1].time));
     }
   Print("[EXP] done");
  }
