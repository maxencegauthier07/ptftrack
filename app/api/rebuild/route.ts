import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import {
  fetchAllFxRates,
  fetchHistoryBatch,
  fetchFxHistory,
  BENCHMARK,
} from "@/lib/yahoo";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Log = { level: "info" | "warn" | "error"; msg: string };

function tradingDays(from: string, to: string): string[] {
  const days: string[] = [];
  const d = new Date(from);
  const end = new Date(to);
  while (d <= end) {
    if (d.getDay() !== 0 && d.getDay() !== 6) days.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

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
  if (ticker.endsWith(".MX")) return "USD";
  return "USD";
}

function tradeCurrency(notes: string | null, accountCurrency: string): string {
  if (!notes) return accountCurrency;
  const match = notes.match(/^\[([A-Z]{3})\]/);
  return match ? match[1] : accountCurrency;
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    const referer = req.headers.get("referer");
    if (auth !== `Bearer ${secret}` && !referer)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const logs: Log[] = [];
  const log = (level: Log["level"], msg: string) => {
    logs.push({ level, msg });
    console.log(`[rebuild][${level}] ${msg}`);
  };

  try {
    const sb = createServerSupabase();

    const personId = req.nextUrl.searchParams.get("person_id");
    const fromDate = req.nextUrl.searchParams.get("from");
    const toDate = req.nextUrl.searchParams.get("to") || new Date().toISOString().slice(0, 10);

    if (!personId) return NextResponse.json({ error: "person_id requis" }, { status: 400 });
    if (!fromDate) return NextResponse.json({ error: "from requis (YYYY-MM-DD)" }, { status: 400 });

    log("info", `━━━ REBUILD ${personId} ${fromDate} → ${toDate} ━━━`);

    const allFxRates = await fetchAllFxRates();
    const fxUsdEur = allFxRates["USDEUR"] || 0.87;
    log("info", `FX actuel USDEUR=${fxUsdEur.toFixed(4)}`);

    const { data: accounts } = await sb.from("accounts")
      .select("*, people(name)").eq("person_id", personId);
    if (!accounts?.length) return NextResponse.json({ error: "Pas de comptes" }, { status: 404 });

    const accountIds = accounts.map(a => a.id);
    const person = (accounts[0] as any).people?.name || personId.slice(0, 8);

    const [tradesR, cashMovsR, pnlsR, divsR] = await Promise.all([
      sb.from("trades").select("*").in("account_id", accountIds).order("date", { ascending: true }),
      sb.from("cash_movements").select("*").in("account_id", accountIds).order("date", { ascending: true }),
      sb.from("realized_pnl").select("*").in("account_id", accountIds).order("date", { ascending: true }),
      sb.from("dividends").select("*").in("account_id", accountIds).order("date", { ascending: true }),
    ]);

    const trades = tradesR.data || [];
    const cashMovs = cashMovsR.data || [];
    const pnls = pnlsR.data || [];
    const dividends = divsR.data || [];

    log("info", `Data: ${trades.length} trades, ${cashMovs.length} cash, ${pnls.length} pnl, ${dividends.length} div`);

    await sb.from("daily_snapshots").delete()
      .in("account_id", accountIds).gte("date", fromDate).lte("date", toDate);
    await sb.from("networth_snapshots").delete()
      .eq("person_id", personId).gte("date", fromDate).lte("date", toDate);
    log("info", "Anciens snapshots nettoyés");

    const allTickers = Array.from(new Set([
      ...trades.map(t => t.ticker),
      ...accounts.flatMap(a => BENCHMARK[a.benchmark] ? [BENCHMARK[a.benchmark]] : []),
    ]));

    const days = tradingDays(fromDate, toDate);
    const daysBack = Math.max(days.length + 30, 30);

    log("info", `Fetching prices for ${allTickers.length} tickers over ${daysBack}d...`);
    const [histories, fxHistory] = await Promise.all([
      fetchHistoryBatch(allTickers, daysBack),
      fetchFxHistory(daysBack),
    ]);
    const missingTickers = allTickers.filter(t => !histories.has(t) || histories.get(t)!.size < 5);
    if (missingTickers.length) log("warn", `Prix manquants: ${missingTickers.join(", ")}`);

    // ─────────────────────────────────────────────
    // STRATEGY : on TIENT TOUT EN EUR côté cash
    // ─────────────────────────────────────────────
    // - cash_movements.amount = EUR (toujours)
    // - trades.price avec notes=[EUR] sur compte USD = EUR natif
    // - trades.price avec notes=[USD] sur compte USD = USD (converti en EUR)
    // - trades sur PEA = EUR natif
    // - dividends.amount = EUR
    // - realized_pnl.amount = EUR
    //
    // Les holdings sont toujours évalués en prix natif ticker, converti en EUR.
    // Le snapshot stocke portfolio_value dans la devise du compte (USD ou EUR),
    // mais on calcule tout en EUR en interne.
    // ─────────────────────────────────────────────

    type AccState = {
      acc: any;
      cashEur: number;                       // CASH EN EUR pour tous les comptes
      sharesByTicker: Record<string, number>;
    };

    const states: Record<string, AccState> = {};
    for (const a of accounts) {
      states[a.id] = { acc: a, cashEur: 0, sharesByTicker: {} };
    }

    const indexByDate = <T extends { date: string }>(arr: T[]) => {
      const map: Record<string, T[]> = {};
      for (const item of arr) {
        if (!map[item.date]) map[item.date] = [];
        map[item.date].push(item);
      }
      return map;
    };

    const tradesByDate = indexByDate(trades);
    const cashByDate = indexByDate(cashMovs);
    const pnlsByDate = indexByDate(pnls);
    const divsByDate = indexByDate(dividends);

    const getFxForDate = (date: string): number => pickPrice(fxHistory, date, fxUsdEur);

    /**
     * Applique un trade. Prix converti en EUR pour alimenter cashEur.
     */
    const applyTrade = (t: any, dayFx: number) => {
      const s = states[t.account_id];
      if (!s) return;

      const shares = Number(t.shares);
      const priceRaw = Number(t.price);
      const fees = Number(t.fees || 0);
      const tradeCcy = tradeCurrency(t.notes, s.acc.currency);

      // Convertir prix + fees en EUR
      let priceEur = priceRaw;
      let feesEur = fees;
      if (tradeCcy === "USD") {
        priceEur = priceRaw * dayFx;
        feesEur = fees * dayFx;
      } else if (tradeCcy !== "EUR") {
        const toEurRate = allFxRates[`${tradeCcy}EUR`] || 1;
        priceEur = priceRaw * toEurRate;
        feesEur = fees * toEurRate;
      }

      if (t.side === "BUY") {
        s.sharesByTicker[t.ticker] = (s.sharesByTicker[t.ticker] || 0) + shares;
        s.cashEur -= shares * priceEur + feesEur;
      } else {
        s.sharesByTicker[t.ticker] = (s.sharesByTicker[t.ticker] || 0) - shares;
        s.cashEur += shares * priceEur - feesEur;
      }
    };

    // cash_movements en EUR (même sur CTO — confirmé)
    const applyCash = (cm: any) => {
      const s = states[cm.account_id];
      if (s) s.cashEur += Number(cm.amount);
    };

    const applyPnl = (p: any) => {
      const s = states[p.account_id];
      if (s) s.cashEur += Number(p.amount);
    };

    const applyDiv = (d: any) => {
      const s = states[d.account_id];
      if (s) s.cashEur += Number(d.amount);
    };

    // ─────────────────────────────────────────────
    // Catch-up avant fromDate
    // ─────────────────────────────────────────────
    for (const cm of cashMovs) if (cm.date < fromDate) applyCash(cm);
    for (const t of trades) if (t.date < fromDate) applyTrade(t, getFxForDate(t.date));
    for (const p of pnls) if (p.date < fromDate) applyPnl(p);
    for (const d of dividends) if (d.date < fromDate) applyDiv(d);

    log("info", `État au ${fromDate} : ${Object.values(states).map(s => `${s.acc.type}=${s.cashEur.toFixed(0)}EUR`).join(", ")}`);

    // ─────────────────────────────────────────────
    // Boucle jour par jour
    // ─────────────────────────────────────────────

    const nwByDate: Record<string, { stocks: number; bank: number; realEstate: number; loans: number }> = {};
    const prevIndexByAcc: Record<string, { adj: number; raw: number } | null> = {};
    accounts.forEach(a => { prevIndexByAcc[a.id] = null; });

    let processed = 0;
    for (const day of days) {
      const dayFx = getFxForDate(day);

      for (const cm of (cashByDate[day] || [])) applyCash(cm);
      for (const t of (tradesByDate[day] || [])) applyTrade(t, dayFx);
      for (const p of (pnlsByDate[day] || [])) applyPnl(p);
      for (const d of (divsByDate[day] || [])) applyDiv(d);

      let totalStocksEur = 0;

      for (const a of accounts) {
        const s = states[a.id];
        const isCto = a.currency === "USD";

        // Positions valorisées en EUR
        let positionsEur = 0;
        for (const [ticker, shares] of Object.entries(s.sharesByTicker)) {
          if (shares <= 0.00001) continue;
          const hist = histories.get(ticker);
          const rawPrice = hist ? pickPrice(hist, day, 0) : 0;
          if (rawPrice <= 0) continue;

          const priceCcy = tickerCurrency(ticker);
          let priceEur = rawPrice;
          if (priceCcy === "USD") priceEur = rawPrice * dayFx;
          else if (priceCcy !== "EUR") priceEur = rawPrice * (allFxRates[`${priceCcy}EUR`] || 1);

          positionsEur += shares * priceEur;
        }

        const ptfEur = positionsEur + s.cashEur;
        totalStocksEur += ptfEur;

        // Snapshot en devise du compte (pour compat UI)
        const ptfNative = isCto ? (dayFx > 0 ? ptfEur / dayFx : ptfEur) : ptfEur;
        const cashNative = isCto ? (dayFx > 0 ? s.cashEur / dayFx : s.cashEur) : s.cashEur;

        const benchTicker = BENCHMARK[a.benchmark];
        const benchHist = benchTicker ? histories.get(benchTicker) : undefined;
        const indexRaw = benchHist ? pickPrice(benchHist, day, 0) : 0;

        const depositsToday = (cashByDate[day] || [])
          .filter(cm => cm.account_id === a.id)
          .reduce((sum: number, cm: any) => sum + Number(cm.amount), 0);
        // depositsToday est en EUR ; pour un CTO on convertit en native
        const depositsNative = isCto ? (dayFx > 0 ? depositsToday / dayFx : depositsToday) : depositsToday;

        const prev = prevIndexByAcc[a.id];
        let indexAdj: number;
        if (prev && indexRaw > 0 && prev.raw > 0) {
          const dailyReturn = indexRaw / prev.raw;
          indexAdj = prev.adj * dailyReturn + depositsNative;
        } else if (prev) {
          indexAdj = prev.adj + depositsNative;
        } else {
          indexAdj = ptfNative;
        }

        prevIndexByAcc[a.id] = {
          adj: indexAdj,
          raw: indexRaw > 0 ? indexRaw : (prev?.raw || 0),
        };

        await sb.from("daily_snapshots").upsert({
          account_id: a.id,
          date: day,
          portfolio_value: Math.round(ptfNative * 100) / 100,
          index_value: Math.round(indexAdj * 100) / 100,
          index_raw: Math.round(indexRaw * 100) / 100,
          cash: Math.round(s.cashEur * 100) / 100,    // cash stocké en EUR partout
          fx_rate: dayFx,
          confirmed: true,
        }, { onConflict: "account_id,date" });
      }

      if (!nwByDate[day]) nwByDate[day] = { stocks: 0, bank: 0, realEstate: 0, loans: 0 };
      nwByDate[day].stocks = totalStocksEur;

      processed++;
      if (processed % 20 === 0 || day === days[0] || day === days[days.length - 1]) {
        log("info", `${day}: ${Object.values(states).map(s => `${s.acc.type}=${s.cashEur.toFixed(0)}EUR`).join(" ")} ptfEur=${totalStocksEur.toFixed(0)}`);
      }
    }

    // ─────────────────────────────────────────────
    // Networth snapshots
    // ─────────────────────────────────────────────
    const [bankR, propR, loanR] = await Promise.all([
      sb.from("bank_accounts").select("balance, currency").eq("person_id", personId),
      sb.from("properties").select("current_value, ownership_pct, currency").eq("person_id", personId),
      sb.from("loans").select("current_balance, currency").eq("person_id", personId),
    ]);

    const bankEur = (bankR.data || []).reduce((s, b) => {
      const fx = b.currency === "EUR" ? 1 : (allFxRates[`${b.currency}EUR`] || 1);
      return s + Number(b.balance || 0) * fx;
    }, 0);
    const realEstateEur = (propR.data || []).reduce((s, p) => {
      const fx = p.currency === "EUR" ? 1 : (allFxRates[`${p.currency}EUR`] || 1);
      return s + Number(p.current_value || 0) * (Number(p.ownership_pct || 100) / 100) * fx;
    }, 0);
    const loansEur = (loanR.data || []).reduce((s, l) => {
      const fx = l.currency === "EUR" ? 1 : (allFxRates[`${l.currency}EUR`] || 1);
      return s + Number(l.current_balance || 0) * fx;
    }, 0);

    for (const [day, cats] of Object.entries(nwByDate)) {
      cats.bank = bankEur;
      cats.realEstate = realEstateEur;
      cats.loans = loansEur;
      const net = cats.stocks + cats.bank + cats.realEstate - cats.loans;

      await sb.from("networth_snapshots").upsert({
        person_id: personId,
        date: day,
        currency: "EUR",
        stocks: Math.round(cats.stocks * 100) / 100,
        bank: Math.round(cats.bank * 100) / 100,
        real_estate: Math.round(cats.realEstate * 100) / 100,
        loans: Math.round(cats.loans * 100) / 100,
        net: Math.round(net * 100) / 100,
        fx_rates: allFxRates,
        source: "rebuild",
      }, { onConflict: "person_id,date,currency" });
    }

    log("info", `━━━ DONE: ${processed} jours ━━━`);

    return NextResponse.json({
      ok: true,
      person,
      from: fromDate,
      to: toDate,
      days: processed,
      logs: logs.slice(-50),
    });
  } catch (e: any) {
    log("error", e.message || String(e));
    return NextResponse.json({ ok: false, error: e.message, logs }, { status: 500 });
  }
}