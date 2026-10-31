//+------------------------------------------------------------------+
//| ExportDeals.mq5 - writes the account's whole deal history to     |
//| MQL5/Files/Deals_<login>.csv for AlphaBoard (Admin → Lab).        |
//| Times are UTC. Only BUY/SELL deals (no balance/credit rows).      |
//+------------------------------------------------------------------+
#property version "1.00"

void OnStart()
  {
   long   login  = AccountInfoInteger(ACCOUNT_LOGIN);
   string ccy    = AccountInfoString(ACCOUNT_CURRENCY);
   long   offset = (long)(TimeTradeServer() - TimeGMT());   // server minus UTC, seconds
   if(!HistorySelect(0, TimeCurrent() + 86400)) { Print("[DEALS] HistorySelect failed ", GetLastError()); return; }
   string name = "Deals_" + (string)login + ".csv";
   int h = FileOpen(name, FILE_WRITE | FILE_ANSI | FILE_TXT);
   if(h == INVALID_HANDLE) { Print("[DEALS] cannot write ", name); return; }
   FileWriteString(h, "deal,order,position,time_utc,type,entry,symbol,volume,price,sl,tp,commission,swap,profit,fee,magic,comment,login="
                      + (string)login + ",currency=" + ccy + "\n");
   int n = HistoryDealsTotal(), written = 0;
   for(int i = 0; i < n; i++)
     {
      ulong d = HistoryDealGetTicket(i);
      if(d == 0) continue;
      long type = HistoryDealGetInteger(d, DEAL_TYPE);
      if(type != DEAL_TYPE_BUY && type != DEAL_TYPE_SELL) continue;
      string comment = HistoryDealGetString(d, DEAL_COMMENT);
      StringReplace(comment, ",", " ");
      StringReplace(comment, "\n", " ");
      FileWriteString(h, StringFormat("%I64u,%I64d,%I64d,%I64d,%I64d,%I64d,%s,%.2f,%.10g,%.10g,%.10g,%.2f,%.2f,%.2f,%.2f,%I64d,%s\n",
                      d, HistoryDealGetInteger(d, DEAL_ORDER), HistoryDealGetInteger(d, DEAL_POSITION_ID),
                      (long)HistoryDealGetInteger(d, DEAL_TIME) - offset, type, HistoryDealGetInteger(d, DEAL_ENTRY),
                      HistoryDealGetString(d, DEAL_SYMBOL), HistoryDealGetDouble(d, DEAL_VOLUME), HistoryDealGetDouble(d, DEAL_PRICE),
                      HistoryDealGetDouble(d, DEAL_SL), HistoryDealGetDouble(d, DEAL_TP),
                      HistoryDealGetDouble(d, DEAL_COMMISSION), HistoryDealGetDouble(d, DEAL_SWAP), HistoryDealGetDouble(d, DEAL_PROFIT),
                      HistoryDealGetDouble(d, DEAL_FEE), HistoryDealGetInteger(d, DEAL_MAGIC), comment));
      written++;
     }
   FileClose(h);
   PrintFormat("[DEALS] %d deals written to MQL5/Files/%s", written, name);
  }
