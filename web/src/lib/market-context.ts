import type { MarketSnapshot } from "@/types/database";

const CACHE_TTL_MS = 120_000;
const FETCH_TIMEOUT_MS = 3_000;

const CDN_URL =
  "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies";
const FALLBACK_URL = "https://latest.currency-api.pages.dev/v1/currencies";

const MAJOR_PAIRS = new Set([
  "EURUSD",
  "GBPUSD",
  "USDJPY",
  "USDCHF",
  "AUDUSD",
  "USDCAD",
  "NZDUSD",
  "EURGBP",
  "EURJPY",
  "GBPJPY",
  "AUDJPY",
  "EURAUD",
  "EURCHF",
  "GBPCHF",
  "CADJPY",
  "CHFJPY",
  "NZDJPY",
  "AUDCAD",
  "AUDNZD",
  "EURCAD",
  "EURNZD",
  "GBPAUD",
  "GBPCAD",
  "GBPNZD",
  "USDMXN",
  "USDZAR",
  "XAUUSD",
]);

const priceCache = new Map<string, { price: number; asOf: string; expires: number }>();

export interface TradeFactsInput {
  asset: string | null;
  timeframe: string | null;
  entry_zone: string | null;
  stop_loss: string | null;
  take_profit: string | null;
}

export function normalizeForexSymbol(raw: string | null): string | null {
  if (!raw?.trim()) return null;

  const cleaned = raw.toUpperCase().replace(/[^A-Z]/g, "");
  if (cleaned.length === 6 && MAJOR_PAIRS.has(cleaned)) return cleaned;

  const slashMatch = raw.toUpperCase().match(/([A-Z]{3})\s*[/\s-]\s*([A-Z]{3})/);
  if (slashMatch) {
    const pair = `${slashMatch[1]}${slashMatch[2]}`;
    if (MAJOR_PAIRS.has(pair)) return pair;
  }

  if (cleaned.length === 6) return cleaned;
  return null;
}

export function getTradingSession(now = new Date()): string {
  const hour = now.getUTCHours();

  if (hour >= 13 && hour < 22) return "Nueva York";
  if (hour >= 8 && hour < 17) return "Londres";
  if (hour >= 0 && hour < 9) return "Tokio";
  if (hour >= 22 || hour < 7) return "Sídney";
  return "Fuera de sesión principal";
}

export function parsePriceLevel(text: string | null): number | null {
  if (!text?.trim()) return null;
  const match = text.replace(/,/g, "").match(/(\d+\.?\d*)/);
  if (!match) return null;
  const value = parseFloat(match[1]);
  return Number.isFinite(value) ? value : null;
}

function pipSize(symbol: string): number {
  return symbol.includes("JPY") && !symbol.startsWith("JPY") ? 0.01 : 0.0001;
}

export function computePipDistance(
  a: number,
  b: number,
  symbol: string
): number {
  const pip = pipSize(symbol);
  return Math.round(Math.abs(a - b) / pip);
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal, next: { revalidate: 120 } });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSpotRate(base: string, quote: string): Promise<number | null> {
  const cacheKey = `${base}/${quote}`;
  const cached = priceCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return cached.price;
  }

  const urls = [
    `${CDN_URL}/${base}.min.json`,
    `${FALLBACK_URL}/${base}.min.json`,
  ];

  for (const url of urls) {
    try {
      const res = await fetchWithTimeout(url);
      if (!res.ok) continue;

      const data = (await res.json()) as Record<string, Record<string, number>>;
      const rate = data[base]?.[quote];
      if (typeof rate !== "number" || !Number.isFinite(rate)) continue;

      const asOf = new Date().toISOString();
      priceCache.set(cacheKey, {
        price: rate,
        asOf,
        expires: Date.now() + CACHE_TTL_MS,
      });
      return rate;
    } catch {
      continue;
    }
  }

  return null;
}

function splitPair(symbol: string): { base: string; quote: string } | null {
  if (symbol === "XAUUSD") return { base: "xau", quote: "usd" };
  if (symbol.length !== 6) return null;
  return {
    base: symbol.slice(0, 3).toLowerCase(),
    quote: symbol.slice(3, 6).toLowerCase(),
  };
}

function formatRiskReward(stopPips: number | null, rewardPips: number | null): string | null {
  if (!stopPips || !rewardPips || stopPips <= 0) return null;
  const ratio = rewardPips / stopPips;
  return `1:${ratio % 1 === 0 ? ratio : ratio.toFixed(1)}`;
}

export async function buildMarketSnapshot(
  facts: TradeFactsInput
): Promise<MarketSnapshot | null> {
  const symbol = normalizeForexSymbol(facts.asset);
  if (!symbol) return null;

  const parts = splitPair(symbol);
  if (!parts) return null;

  const referencePrice = await fetchSpotRate(parts.base, parts.quote);
  if (referencePrice === null) return null;

  const chartEntry = parsePriceLevel(facts.entry_zone);
  const stopLoss = parsePriceLevel(facts.stop_loss);
  const takeProfit = parsePriceLevel(facts.take_profit);

  const entryVsReferencePips =
    chartEntry !== null
      ? computePipDistance(chartEntry, referencePrice, symbol)
      : null;

  const stopPips =
    chartEntry !== null && stopLoss !== null
      ? computePipDistance(chartEntry, stopLoss, symbol)
      : null;

  const rewardPips =
    chartEntry !== null && takeProfit !== null
      ? computePipDistance(chartEntry, takeProfit, symbol)
      : null;

  const cached = priceCache.get(`${parts.base}/${parts.quote}`);

  return {
    symbol: symbol === "XAUUSD" ? "XAU/USD" : `${symbol.slice(0, 3)}/${symbol.slice(3)}`,
    timeframe: facts.timeframe,
    session: getTradingSession(),
    referencePrice,
    chartEntry,
    stopLoss,
    takeProfit,
    entryVsReferencePips,
    stopPips,
    rewardPips,
    riskReward: formatRiskReward(stopPips, rewardPips),
    source: "exchange-api",
    asOf: cached?.asOf ?? new Date().toISOString(),
    freshness: "daily",
  };
}

export function formatMarketSnapshotForPrompt(snapshot: MarketSnapshot): string {
  const lines = [
    `- Par: ${snapshot.symbol} · Sesión: ${snapshot.session} · Referencia: ${snapshot.referencePrice}`,
    `- Fuente: ${snapshot.source} (actualización diaria, solo referencia)`,
  ];

  if (snapshot.chartEntry !== null) {
    const pips =
      snapshot.entryVsReferencePips !== null
        ? ` (${snapshot.entryVsReferencePips} pips vs referencia)`
        : "";
    lines.push(`- Entrada en captura: ${snapshot.chartEntry}${pips}`);
  }

  if (snapshot.stopPips !== null || snapshot.rewardPips !== null) {
    const parts = [];
    if (snapshot.stopPips !== null) parts.push(`Stop: ${snapshot.stopPips} pips`);
    if (snapshot.rewardPips !== null) parts.push(`TP: ${snapshot.rewardPips} pips`);
    if (snapshot.riskReward) parts.push(`R:R ${snapshot.riskReward}`);
    lines.push(`- ${parts.join(" · ")}`);
  }

  return lines.join("\n");
}
