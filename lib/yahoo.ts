/**
 * Yahoo Finance — zero dependencies.
 * Current prices + historical daily closes for backfill.
 */

const YF_URL = "https://query2.finance.yahoo.com/v8/finance/chart";

/** Fetch latest price for a ticker. Uses intraday 5m for live, falls back to daily. */
export async function fetchPrice(ticker: string): Promise<number | null> {
  try {
    // 1. Try intraday 5min — gives the most recent traded price
    const res = await fetch(
      `${YF_URL}/${encodeURIComponent(ticker)}?range=1d&interval=5m`,
      { headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store" }
    );
    if (res.ok) {
      const data = await res.json();
      const result = data?.chart?.result?.[0];
      if (result) {
        // meta.regularMarketPrice = most reliable live price
        const live = result.meta?.regularMarketPrice;
        if (live && !isNaN(live) && live > 0) return Math.round(live * 10000) / 10000;

        // Fallback: last intraday candle close
        const closes: number[] = result.indicators?.quote?.[0]?.close || [];
        for (let i = closes.length - 1; i >= 0; i--) {
          if (closes[i] != null && !isNaN(closes[i]) && closes[i] > 0)
            return Math.round(closes[i] * 10000) / 10000;
        }
      }
    }

    // 2. Fallback: daily candles
    const res2 = await fetch(
      `${YF_URL}/${encodeURIComponent(ticker)}?range=5d&interval=1d`,
      { headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store" }
    );
    if (res2.ok) {
      const data2 = await res2.json();
      const result2 = data2?.chart?.result?.[0];
      if (result2) {
        const live2 = result2.meta?.regularMarketPrice;
        if (live2 && !isNaN(live2) && live2 > 0) return Math.round(live2 * 10000) / 10000;

        const closes2: number[] = result2.indicators?.quote?.[0]?.close || [];
        for (let i = closes2.length - 1; i >= 0; i--) {
          if (closes2[i] != null && !isNaN(closes2[i]) && closes2[i] > 0)
            return Math.round(closes2[i] * 10000) / 10000;
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

export async function fetchPrices(tickers: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  // Batch in groups of 5 to avoid Yahoo rate limiting
  const batchSize = 5;
  for (let i = 0; i < tickers.length; i += batchSize) {
    const batch = tickers.slice(i, i + batchSize);
    const results = await Promise.allSettled(batch.map(fetchPrice));
    batch.forEach((t, j) => {
      const r = results[j];
      if (r.status === "fulfilled" && r.value != null) map.set(t, r.value);
    });
    // Small delay between batches
    if (i + batchSize < tickers.length) await new Promise(r => setTimeout(r, 200));
  }
  return map;
}

/** Daily close history → Map<"YYYY-MM-DD", price>. */
export async function fetchHistory(
  ticker: string,
  daysBack: number
): Promise<Map<string, number>> {
  const range =
    daysBack <= 5 ? "5d" : daysBack <= 25 ? "1mo" : daysBack <= 65 ? "3mo" : "6mo";
  const map = new Map<string, number>();
  try {
    const res = await fetch(
      `${YF_URL}/${encodeURIComponent(ticker)}?range=${range}&interval=1d`,
      { headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store" }
    );
    if (!res.ok) return map;
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return map;
    const ts: number[] = result.timestamp || [];
    const closes: number[] = result.indicators?.quote?.[0]?.close || [];
    for (let i = 0; i < ts.length; i++) {
      if (closes[i] != null && !isNaN(closes[i])) {
        const key = new Date(ts[i] * 1000).toISOString().slice(0, 10);
        map.set(key, Math.round(closes[i] * 10000) / 10000);
      }
    }
  } catch {}
  return map;
}

/** History for multiple tickers → Map<ticker, Map<date, price>>. */
export async function fetchHistoryBatch(
  tickers: string[],
  daysBack: number
): Promise<Map<string, Map<string, number>>> {
  const results = await Promise.allSettled(
    tickers.map((t) => fetchHistory(t, daysBack))
  );
  const out = new Map<string, Map<string, number>>();
  tickers.forEach((t, i) => {
    const r = results[i];
    out.set(t, r.status === "fulfilled" ? r.value : new Map());
  });
  return out;
}

// FX pairs: Yahoo ticker → our pair name
// Rate = how many EUR per 1 unit of foreign currency
export const FX_PAIRS: Record<string, string> = {
  "EURUSD=X": "USDEUR",   // 1 USD = ? EUR
  "EURCAD=X": "CADEUR",   // 1 CAD = ? EUR
  "EURAUD=X": "AUDEUR",   // 1 AUD = ? EUR
};

/** Fetch all FX rates (XXXEUR). Returns { USDEUR: 0.866, CADEUR: 0.633, AUDEUR: 0.556 } */
export async function fetchAllFxRates(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const entries = Object.entries(FX_PAIRS);
  const prices = await fetchPrices(entries.map(([t]) => t));
  for (const [ticker, pair] of entries) {
    const eurXxx = prices.get(ticker);
    if (eurXxx && eurXxx > 0) {
      out[pair] = Math.round((1 / eurXxx) * 100000) / 100000;
    }
  }
  return out;
}

/** Fetch single USDEUR rate (backwards compat). */
export async function fetchFxRate(): Promise<number> {
  const rates = await fetchAllFxRates();
  return rates["USDEUR"] || 0.87;
}

/** USDEUR history → Map<date, rate>. */
export async function fetchFxHistory(daysBack: number): Promise<Map<string, number>> {
  const raw = await fetchHistory("EURUSD=X", daysBack);
  const out = new Map<string, number>();
  for (const [date, eurusd] of raw) {
    if (eurusd > 0) out.set(date, Math.round((1 / eurusd) * 100000) / 100000);
  }
  return out;
}

export const BENCHMARK: Record<string, string> = {
  SP500: "^GSPC",
  CAC40: "^FCHI",
};