import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import {
  fetchPrices,
  fetchAllFxRates,
  fetchHistoryBatch,
  fetchFxHistory,
  BENCHMARK,
} from "@/lib/yahoo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function pickPrice(history: Map<string, number>, date: string, fallback: number): number {
  if (history.has(date)) return history.get(date)!;
  const d = new Date(date);
  for (let i = 1; i <= 7; i++) {
    d.setDate(d.getDate() - 1);
    if (history.has(d.toISOString().slice(0, 10))) return history.get(d.toISOString().slice(0, 10))!;
  }
  return fallback;
}

function tickerCurrency(ticker: string): string {
  if (ticker.endsWith(".AX")) return "AUD";
  if (ticker.endsWith(".PA") || ticker.endsWith(".AS") || ticker.endsWith(".BR") || ticker.endsWith(".DE") || ticker.endsWith(".SG")) return "EUR";
  if (ticker.endsWith(".L")) return "GBP";
  if (ticker.endsWith(".TO") || ticker.endsWith(".V")) return "CAD";
  if (ticker.endsWith(".MX")) return "MXN";
  return "USD";
}

function tradeCurrency(notes: string | null, accountCurrency: string): string {
  if (!notes) return accountCurrency;
  const match = notes.match(/^\[([A-Z]{3})\]/);
  return match ? match[1] : accountCurrency;
}

function resolveFxToEur(ccy: string, dayFx: number, allFxRates: Record<string, number>): number {
  if (ccy === "EUR") return 1;
  if (ccy === "USD") return dayFx;
  if (ccy === "MXN") return allFxRates["MXNEUR"] || 0.049;
  return allFxRates[`${ccy}EUR`] || 1;
}

async function loadContext(sb: any, personId: string) {
  const { data: accounts } = await sb.from("accounts")
    .select("*, people(name)").eq("person_id", personId);
  if (!accounts?.length) throw new Error("Pas de comptes pour cette personne");

  const accountIds = accounts.map((a: any) => a.id);

  const [tradesR, cashMovsR, pnlsR, divsR] = await Promise.all([
    sb.from("trades").select("*").in("account_id", accountIds).order("date", { ascending: true }),
    sb.from("cash_movements").select("*").in("account_id", accountIds).order("date", { ascending: true }),
    sb.from("realized_pnl").select("*").in("account_id", accountIds).order("date", { ascending: true }),
    sb.from("dividends").select("*").in("account_id", accountIds).order("date", { ascending: true }),
  ]);

  return {
    accounts,
    trades: tradesR.data || [],
    cashMovs: cashMovsR.data || [],
    pnls: pnlsR.data || [],
    dividends: divsR.data || [],
  };
}

function computeStateUpToDate(
  accounts: any[],
  trades: any[],
  cashMovs: any[],
  pnls: any[],
  dividends: any[],
  fxHistory: Map<string, number>,
  allFxRates: Record<string, number>,
  fxUsdEur: number,
  upToDate: string
) {
  type AccState = {
    acc: any;
    cashEur: number;
    sharesByTicker: Record<string, number>;
  };

  const states: Record<string, AccState> = {};
  for (const a of accounts) {
    states[a.id] = { acc: a, cashEur: 0, sharesByTicker: {} };
  }

  const getFxForDate = (date: string): number => pickPrice(fxHistory, date, fxUsdEur);

  const applyTrade = (t: any, dayFx: number) => {
    const s = states[t.account_id];
    if (!s) return;
    const shares = Number(t.shares);
    const priceRaw = Number(t.price);
    const fees = Number(t.fees || 0);
    const tradeCcy = tradeCurrency(t.notes, s.acc.currency);

    const fxToEur = resolveFxToEur(tradeCcy, dayFx, allFxRates);
    const priceEur = priceRaw * fxToEur;
    const feesEur = fees * fxToEur;

    if (t.side === "BUY") {
      s.sharesByTicker[t.ticker] = (s.sharesByTicker[t.ticker] || 0) + shares;
      s.cashEur -= shares * priceEur + feesEur;
    } else {
      s.sharesByTicker[t.ticker] = (s.sharesByTicker[t.ticker] || 0) - shares;
      s.cashEur += shares * priceEur - feesEur;
    }
  };

  for (const cm of cashMovs) {
    if (cm.date > upToDate) break;
    states[cm.account_id]!.cashEur += Number(cm.amount);
  }
  for (const t of trades) {
    if (t.date > upToDate) break;
    applyTrade(t, getFxForDate(t.date));
  }
  for (const p of pnls) {
    if (p.date > upToDate) break;
    states[p.account_id]!.cashEur += Number(p.amount);
  }
  for (const d of dividends) {
    if (d.date > upToDate) break;
    states[d.account_id]!.cashEur += Number(d.amount);
  }

  return states;
}

export async function GET(req: NextRequest) {
  try {
    const sb = createServerSupabase();
    const personId = req.nextUrl.searchParams.get("person_id");
    const date = req.nextUrl.searchParams.get("date");
    if (!personId || !date) {
      return NextResponse.json({ error: "person_id + date requis" }, { status: 400 });
    }

    const ctx = await loadContext(sb, personId);
    const allFxRates = await fetchAllFxRates();
    const fxUsdEur = allFxRates["USDEUR"] || 0.87;

    const allTickers = Array.from(new Set([
      ...ctx.trades.map((t: any) => t.ticker),
      ...ctx.accounts.flatMap((a: any) => BENCHMARK[a.benchmark] ? [BENCHMARK[a.benchmark]] : []),
    ]));

    // ★ Fetch en parallèle : historique + prix actuels (live, fallback ETC)
    const [histories, fxHistory, currentPrices] = await Promise.all([
      fetchHistoryBatch(allTickers, 220),
      fetchFxHistory(220),
      fetchPrices(allTickers),
    ]);

    const states = computeStateUpToDate(
      ctx.accounts, ctx.trades, ctx.cashMovs, ctx.pnls, ctx.dividends,
      fxHistory, allFxRates, fxUsdEur, date
    );

    const dayFx = pickPrice(fxHistory, date, fxUsdEur);

    const dayEvents = {
      trades: ctx.trades.filter((t: any) => t.date === date),
      cashMovs: ctx.cashMovs.filter((cm: any) => cm.date === date),
      pnls: ctx.pnls.filter((p: any) => p.date === date),
      dividends: ctx.dividends.filter((d: any) => d.date === date),
    };

    const preview: Record<string, any> = {};
    let totalPtfEur = 0;

    for (const a of ctx.accounts) {
      const s = states[a.id];
      const isCto = a.currency === "USD";

      const holdingsDetail: any[] = [];
      let positionsEur = 0;

      for (const [ticker, shares] of Object.entries(s.sharesByTicker)) {
        if (shares <= 0.00001) continue;
        const hist = histories.get(ticker);
        const histPrice = hist ? pickPrice(hist, date, 0) : 0;

        // ★ Fallback : si pas d'historique, utilise prix actuel (live quote)
        let rawPrice = histPrice;
        let priceSource: "history" | "live-fallback" | "missing" = "history";
        if (rawPrice <= 0) {
          const live = currentPrices.get(ticker);
          if (live && live > 0) {
            rawPrice = live;
            priceSource = "live-fallback";
          } else {
            priceSource = "missing";
          }
        }

        const priceCcy = tickerCurrency(ticker);
        const fxToEur = resolveFxToEur(priceCcy, dayFx, allFxRates);
        const priceEur = rawPrice * fxToEur;
        const valueEur = shares * priceEur;
        positionsEur += valueEur;

        holdingsDetail.push({
          ticker,
          shares,
          priceNative: rawPrice,
          priceCcy,
          priceEur: Math.round(priceEur * 10000) / 10000,
          valueEur: Math.round(valueEur * 100) / 100,
          priceAvailable: rawPrice > 0,
          priceSource,
        });
      }

      const ptfEur = positionsEur + s.cashEur;
      totalPtfEur += ptfEur;

      const ptfNative = isCto ? (dayFx > 0 ? ptfEur / dayFx : ptfEur) : ptfEur;

      preview[a.id] = {
        accountType: a.type,
        currency: a.currency,
        cashEur: Math.round(s.cashEur * 100) / 100,
        holdings: holdingsDetail.sort((x, y) => y.valueEur - x.valueEur),
        positionsEur: Math.round(positionsEur * 100) / 100,
        ptfEur: Math.round(ptfEur * 100) / 100,
        ptfNative: Math.round(ptfNative * 100) / 100,
      };
    }

    const accountIds = ctx.accounts.map((a: any) => a.id);
    const { data: existingSnaps } = await sb.from("daily_snapshots")
      .select("*").in("account_id", accountIds).eq("date", date);

    return NextResponse.json({
      ok: true,
      date,
      dayFx,
      preview,
      totalPtfEur: Math.round(totalPtfEur * 100) / 100,
      dayEvents,
      existingSnaps: existingSnaps || [],
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const sb = createServerSupabase();
    const body = await req.json();
    const { person_id, date, overrides } = body;

    if (!person_id || !date) {
      return NextResponse.json({ error: "person_id + date requis" }, { status: 400 });
    }

    const ctx = await loadContext(sb, person_id);
    const allFxRates = await fetchAllFxRates();
    const fxUsdEur = allFxRates["USDEUR"] || 0.87;

    const allTickers = Array.from(new Set([
      ...ctx.trades.map((t: any) => t.ticker),
      ...ctx.accounts.flatMap((a: any) => BENCHMARK[a.benchmark] ? [BENCHMARK[a.benchmark]] : []),
    ]));

    const [histories, fxHistory, currentPrices] = await Promise.all([
      fetchHistoryBatch(allTickers, 220),
      fetchFxHistory(220),
      fetchPrices(allTickers),
    ]);

    const states = computeStateUpToDate(
      ctx.accounts, ctx.trades, ctx.cashMovs, ctx.pnls, ctx.dividends,
      fxHistory, allFxRates, fxUsdEur, date
    );

    const dayFx = pickPrice(fxHistory, date, fxUsdEur);

    let totalStocksEur = 0;
    const results: any[] = [];

    for (const a of ctx.accounts) {
      const s = states[a.id];
      const isCto = a.currency === "USD";

      const ov = overrides?.[a.id];
      if (ov) {
        if (typeof ov.cashEur === "number") s.cashEur = ov.cashEur;
        if (ov.holdings) {
          for (const [ticker, shares] of Object.entries(ov.holdings)) {
            s.sharesByTicker[ticker] = Number(shares);
          }
        }
      }

      let positionsEur = 0;
      for (const [ticker, shares] of Object.entries(s.sharesByTicker)) {
        if (shares <= 0.00001) continue;
        const priceOverride = ov?.priceEurOverrides?.[ticker];
        let priceEur: number;
        if (typeof priceOverride === "number" && priceOverride > 0) {
          priceEur = priceOverride;
        } else {
          const hist = histories.get(ticker);
          let rawPrice = hist ? pickPrice(hist, date, 0) : 0;
          if (rawPrice <= 0) {
            const live = currentPrices.get(ticker);
            if (live && live > 0) rawPrice = live;
          }
          if (rawPrice <= 0) continue;
          const priceCcy = tickerCurrency(ticker);
          const fxToEur = resolveFxToEur(priceCcy, dayFx, allFxRates);
          priceEur = rawPrice * fxToEur;
        }
        positionsEur += shares * priceEur;
      }

      const ptfEur = positionsEur + s.cashEur;
      totalStocksEur += ptfEur;

      const ptfNative = isCto ? (dayFx > 0 ? ptfEur / dayFx : ptfEur) : ptfEur;

      const { data: prev } = await sb.from("daily_snapshots")
        .select("index_value, index_raw").eq("account_id", a.id)
        .lt("date", date).order("date", { ascending: false }).limit(1);

      const benchTicker = BENCHMARK[a.benchmark];
      const benchHist = benchTicker ? histories.get(benchTicker) : undefined;
      const indexRaw = benchHist ? pickPrice(benchHist, date, 0) : 0;

      const depositsToday = ctx.cashMovs
        .filter((cm: any) => cm.account_id === a.id && cm.date === date)
        .reduce((sum: number, cm: any) => sum + Number(cm.amount), 0);
      const depositsNative = isCto ? (dayFx > 0 ? depositsToday / dayFx : depositsToday) : depositsToday;

      let indexAdj: number;
      const prevSnap = prev?.[0];
      if (prevSnap && indexRaw > 0 && Number(prevSnap.index_raw) > 0) {
        const ret = indexRaw / Number(prevSnap.index_raw);
        indexAdj = Number(prevSnap.index_value) * ret + depositsNative;
      } else if (prevSnap) {
        indexAdj = Number(prevSnap.index_value) + depositsNative;
      } else {
        indexAdj = ptfNative;
      }

      await sb.from("daily_snapshots").upsert({
        account_id: a.id,
        date,
        portfolio_value: Math.round(ptfNative * 100) / 100,
        index_value: Math.round(indexAdj * 100) / 100,
        index_raw: Math.round(indexRaw * 100) / 100,
        cash: Math.round(s.cashEur * 100) / 100,
        fx_rate: dayFx,
        confirmed: true,
      }, { onConflict: "account_id,date" });

      results.push({
        accId: a.id,
        type: a.type,
        cashEur: Math.round(s.cashEur * 100) / 100,
        ptfEur: Math.round(ptfEur * 100) / 100,
      });
    }

    const [bankR, propR, loanR] = await Promise.all([
      sb.from("bank_accounts").select("balance, currency").eq("person_id", person_id),
      sb.from("properties").select("current_value, ownership_pct, currency").eq("person_id", person_id),
      sb.from("loans").select("current_balance, currency").eq("person_id", person_id),
    ]);

    const bankEur = (bankR.data || []).reduce((s: number, b: any) => {
      const fx = b.currency === "EUR" ? 1 : (allFxRates[`${b.currency}EUR`] || 1);
      return s + Number(b.balance || 0) * fx;
    }, 0);
    const realEstateEur = (propR.data || []).reduce((s: number, p: any) => {
      const fx = p.currency === "EUR" ? 1 : (allFxRates[`${p.currency}EUR`] || 1);
      return s + Number(p.current_value || 0) * (Number(p.ownership_pct || 100) / 100) * fx;
    }, 0);
    const loansEur = (loanR.data || []).reduce((s: number, l: any) => {
      const fx = l.currency === "EUR" ? 1 : (allFxRates[`${l.currency}EUR`] || 1);
      return s + Number(l.current_balance || 0) * fx;
    }, 0);

    const net = totalStocksEur + bankEur + realEstateEur - loansEur;

    await sb.from("networth_snapshots").upsert({
      person_id,
      date,
      currency: "EUR",
      stocks: Math.round(totalStocksEur * 100) / 100,
      bank: Math.round(bankEur * 100) / 100,
      real_estate: Math.round(realEstateEur * 100) / 100,
      loans: Math.round(loansEur * 100) / 100,
      net: Math.round(net * 100) / 100,
      fx_rates: allFxRates,
      source: "rebuild-step",
    }, { onConflict: "person_id,date,currency" });

    return NextResponse.json({
      ok: true,
      date,
      results,
      totalStocksEur: Math.round(totalStocksEur * 100) / 100,
      net: Math.round(net * 100) / 100,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
