import { redirect } from "next/navigation";
import DashboardScreen from "@/components/DashboardScreen";
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

  return <DashboardScreen routeSymbol={asset?.symbol ?? fallbackAsset?.symbol ?? DEFAULT_WATCHLIST[0]} />;
}
