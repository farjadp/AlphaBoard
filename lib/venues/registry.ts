import "server-only";
import type { ExchangeConnection } from "@prisma/client";
import { ccxtVenue } from "./ccxt";
import type { Venue } from "./types";

/** The venue behind a stored connection: OANDA (forex / metals) or a ccxt crypto exchange. */
export async function venueForConnection(conn: ExchangeConnection): Promise<Venue> {
  if (conn.provider === "oanda") return (await import("./oanda")).oandaVenue(conn);
  return ccxtVenue(conn);
}
