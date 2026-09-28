import { redirect } from "next/navigation";
import MarketScreen from "@/components/market/MarketScreen";
import { assetHref, DEFAULT_WATCHLIST, findAsset, findAssetBySlug, symbolToSlug } from "@/lib/assetCatalog";

interface MarketAssetPageProps {
  params: Promise<{
    symbol: string;
  }>;
}

export default async function MarketAssetPage({ params }: MarketAssetPageProps) {
  const { symbol } = await params;
  const asset = findAssetBySlug(symbol);
  const fallbackAsset = findAsset(DEFAULT_WATCHLIST[0]);

  if (asset && symbol !== symbolToSlug(asset.symbol)) {
    redirect(assetHref(asset.symbol));
  }

  const resolved = asset?.symbol ?? fallbackAsset?.symbol ?? DEFAULT_WATCHLIST[0];
  // Keyed so every symbol starts with fresh timeframe, strategy and data state.
  return <MarketScreen key={resolved} symbol={resolved} />;
}
