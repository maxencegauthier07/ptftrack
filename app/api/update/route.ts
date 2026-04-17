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
  for (let i = 1; i <= 5; i++) {
    d.setDate(d.getDate() - 1);
    if (history.has(d.toISOString().slice(0, 10))) return history.get(d.toISOString().slice(0, 10))!;
  }
  return fallback;
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
  const log = (level: Log["level"], msg: string) => logs.push({ level, msg });

  try {
    const sb = createServerSupabase();
    const today = new Date().toISOString().slice(0, 10);
    const targetDate = req.nextUrl.searchParams.get("date") || today;
    const force = req.nextUrl.searchParams.get("force") === "true";

    // ★ NEW : scope — permet de limiter le recalc à UN account ou UNE person
    const scopeAccountId = req.nextUrl.searchParams.get("account_id");
    const scopePersonId = req.nextUrl.searchParams.get("person_id");

    log("info", `Target: ${targetDate}${force ? " (force)" : ""}${scopeAccountId ? ` account=${scopeAccountId}` : ""}${scopePersonId ? ` person=${scopePersonId}` : ""}`);

    // ★ IMPORTANT : ne réécrit les FX rates QUE pour aujourd'hui ou quand on
    // update tout (sans scope). Un Pierre qui saisit un dépôt ne doit pas
    // corrompre les FX d'une date passée pour tout le monde.
    const allFxRates = await fetchAllFxRates();
    const fxUsdEur = allFxRates["USDEUR"] || 0.87;
    log("info", `FX: ${Object.entries(allFxRates).map(([k, v]) => `${k}=${v}`).join(", ")}`);

    const shouldWriteFx = !scopeAccountId && !scopePersonId && targetDate === today;
    if (shouldWriteFx) {
      for (const [pair, rate] of Object.entries(allFxRates)) {
        await sb.from("fx_rates").upsert({ date: targetDate, pair, rate }, { onConflict: "date,pair" });
      }
    } else {
      log("info", `FX skip (scope ou date passée)`);
    }

    // ★ NEW : query filtrée selon le scope
    let accQuery = sb.from("accounts").select("*, people(name)");
    if (scopeAccountId) {
      accQuery = accQuery.eq("id", scopeAccountId);
    } else if (scopePersonId) {
      accQuery = accQuery.eq("person_id", scopePersonId);
    }
    const { data: accounts, error: accErr } = await accQuery;
    if (accErr) throw accErr;
    if (!accounts?.length) return NextResponse.json({ ok: true, logs, updated: 0 });

    let totalUpdated = 0;

    for (const acc of accounts) {
      const who = (acc as any).people?.name || "?";
      const isCto = acc.currency === "USD";
      log("info", `── ${who} ${acc.type} (${acc.currency}) ──`);

      const { data: lastSnap } = await sb.from("daily_snapshots").select("date")
        .eq("account_id", acc.id).order("date", { ascending: false }).limit(1);
      const lastDate = lastSnap?.[0]?.date;
      const startDate = lastDate
        ? new Date(new Date(lastDate).getTime() + 86400000).toISOString().slice(0, 10)
        : targetDate;
      let missingDays = tradingDays(startDate, targetDate);
      if (force) {
        const dow = new Date(targetDate).getDay();
        if (dow !== 0 && dow !== 6 && !missingDays.includes(targetDate)) {
          missingDays.push(targetDate);
        }
      }

      if (!missingDays.length) { log("info", "  Rien à faire"); continue; }

      const { data: holdings } = await sb.from("holdings").select("*")
        .eq("account_id", acc.id).gt("shares", 0);
      if (!holdings?.length) { log("warn", "  Pas de holdings"); continue; }

      const tickers = Array.from(new Set(holdings.map((h: any) => h.ticker)));
      const benchTicker = BENCHMARK[acc.benchmark];
      const allTickers = [...tickers, ...(benchTicker ? [benchTicker] : [])];

      const daysBack = Math.max(missingDays.length + 10, 15);
      const [histories, fxHistory] = await Promise.all([
        fetchHistoryBatch(allTickers, daysBack),
        fetchFxHistory(daysBack),
      ]);
      const currentPrices = await fetchPrices(allTickers);
      log("info", `  Fetch live: ${currentPrices.size}/${allTickers.length} prix`);
      const missing = allTickers.filter(t => !currentPrices.has(t));
      if (missing.length) log("warn", `  Manquants: ${missing.join(", ")}`);

      const tickerCurrency = (ticker: string): string => {
        if (ticker.endsWith(".AX")) return "AUD";
        if (ticker.endsWith(".PA") || ticker.endsWith(".BR") || ticker.endsWith(".DE")) return "EUR";
        if (ticker.endsWith(".L")) return "GBP";
        if (ticker.endsWith(".TO") || ticker.endsWith(".V")) return "CAD";
        return "USD";
      };

      const toAccountCcy = (price: number, ticker: string, dayFxRate: number): number => {
        const priceCcy = tickerCurrency(ticker);
        const acctCcy = acc.currency;
        if (priceCcy === acctCcy) return price;

        const usdeur = dayFxRate;
        const audeur = allFxRates["AUDEUR"] || 0.61;
        const cadeur = allFxRates["CADEUR"] || 0.63;

        let priceEur = price;
        if (priceCcy === "USD") priceEur = price * usdeur;
        else if (priceCcy === "AUD") priceEur = price * audeur;
        else if (priceCcy === "CAD") priceEur = price * cadeur;

        if (acctCcy === "EUR") return priceEur;
        if (acctCcy === "USD") return usdeur > 0 ? priceEur / usdeur : priceEur;
        return priceEur;
      };

      for (const day of missingDays) {
        const isTarget = day === targetDate;
        const fxRate = isTarget ? fxUsdEur : pickPrice(fxHistory, day, fxUsdEur);

        let positionsValue = 0;
        let priceSources = { hist: 0, live: 0, fallback: 0 };
        for (const h of holdings) {
          const hist = histories.get(h.ticker);
          let rawPrice = 0;

          if (hist) rawPrice = pickPrice(hist, day, 0);

          if (rawPrice <= 0 && currentPrices.has(h.ticker)) {
            rawPrice = currentPrices.get(h.ticker)!;
            priceSources.live++;
          } else if (rawPrice > 0) {
            priceSources.hist++;
          }

          if (rawPrice <= 0) {
            positionsValue += h.shares * Number(h.last_price || 0);
            priceSources.fallback++;
            continue;
          }

          const price = toAccountCcy(rawPrice, h.ticker, fxRate);
          positionsValue += h.shares * price;

          // ★ Ne MAJ last_price que si on écrit pour AUJOURD'HUI
          // Sinon on peut écraser le prix courant avec un prix passé
          if (price > 0 && isTarget && day === today) {
            await sb.from("holdings").update({ last_price: price, updated_at: new Date().toISOString() }).eq("id", h.id);
          }
        }
        log("info", `  ${day}: prix hist=${priceSources.hist} live=${priceSources.live} fallback=${priceSources.fallback}`);

        const { data: subAccs } = await sb.from("sub_accounts").select("cash").eq("account_id", acc.id);
        const cashEur = (subAccs || []).reduce((s: number, sa: any) => s + Number(sa.cash || 0), 0);

        let ptfValue: number;
        if (isCto) {
          ptfValue = positionsValue + (fxRate > 0 ? cashEur / fxRate : 0);
        } else {
          ptfValue = positionsValue + cashEur;
        }

        log("info", `  ${day}: pos=${positionsValue.toFixed(0)} cash=${cashEur.toFixed(0)}€ ptf=${ptfValue.toFixed(0)}`);

        const benchHist = benchTicker ? histories.get(benchTicker) : undefined;
        let indexRaw = 0;
        if (isTarget && benchTicker && currentPrices.has(benchTicker)) indexRaw = currentPrices.get(benchTicker)!;
        else if (benchHist) indexRaw = pickPrice(benchHist, day, 0);

        const { data: prevSnaps } = await sb.from("daily_snapshots")
          .select("index_value, index_raw").eq("account_id", acc.id)
          .lt("date", day).order("date", { ascending: false }).limit(1);

        const { data: deposits } = await sb.from("cash_movements")
          .select("amount").eq("account_id", acc.id).eq("date", day);
        const totalDepositEur = (deposits || []).reduce((s: number, d: any) => s + Number(d.amount), 0);

        const depositNative = isCto && fxRate > 0 ? totalDepositEur / fxRate : totalDepositEur;

        let indexAdj: number;
        const prev = prevSnaps?.[0];
        if (prev && indexRaw > 0) {
          let prevRaw = prev.index_raw ? Number(prev.index_raw) : 0;
          if (prevRaw <= 0 && benchHist) {
            const prevDate = await sb.from("daily_snapshots")
              .select("date").eq("account_id", acc.id)
              .lt("date", day).order("date", { ascending: false }).limit(1);
            const prevDay = prevDate?.data?.[0]?.date;
            if (prevDay) prevRaw = pickPrice(benchHist, prevDay, 0);
          }
          if (prevRaw > 0) {
            const dailyReturn = indexRaw / prevRaw;
            indexAdj = Number(prev.index_value) * dailyReturn + depositNative;
          } else {
            indexAdj = Number(prev.index_value) + depositNative;
          }
        } else if (prev) {
          indexAdj = Number(prev.index_value) + depositNative;
        } else {
          indexAdj = ptfValue;
        }

        log("info", `  ${day}: idx_raw=${indexRaw.toFixed(0)} idx_adj=${indexAdj.toFixed(0)} dep=${depositNative.toFixed(0)}`);

        const { error: snapErr } = await sb.from("daily_snapshots").upsert({
          account_id: acc.id, date: day,
          portfolio_value: Math.round(ptfValue * 100) / 100,
          index_value: Math.round(indexAdj * 100) / 100,
          index_raw: Math.round(indexRaw * 100) / 100,
          cash: Math.round(cashEur * 100) / 100,
          fx_rate: fxRate, confirmed: true,
        }, { onConflict: "account_id,date" });

        if (snapErr) log("error", `  ${day}: ${snapErr.message}`);
        else totalUpdated++;
      }

      // MAJ du cash agrégé sur l'account parent — uniquement pour aujourd'hui
      if (targetDate === today) {
        const { data: subAccsFinal } = await sb.from("sub_accounts").select("cash").eq("account_id", acc.id);
        const totalCashEur = (subAccsFinal || []).reduce((s: number, sa: any) => s + Number(sa.cash || 0), 0);
        await sb.from("accounts").update({ cash: Math.round(totalCashEur * 100) / 100 }).eq("id", acc.id);
      }
    }

    // ===========================================================
    // NET WORTH SNAPSHOT par personne
    // ===========================================================
    log("info", "── Net Worth snapshots ──");

    // ★ NEW : ne regénère le NW que pour les personnes concernées par le scope
    let peopleQuery = sb.from("people").select("*");
    if (scopePersonId) {
      peopleQuery = peopleQuery.eq("id", scopePersonId);
    } else if (scopeAccountId) {
      // Si on scope par account, trouve le person_id correspondant
      const { data: accData } = await sb.from("accounts").select("person_id").eq("id", scopeAccountId).single();
      if (accData) peopleQuery = peopleQuery.eq("id", accData.person_id);
    }
    const { data: people } = await peopleQuery;

    if (!people?.length) {
      return NextResponse.json({ ok: true, date: targetDate, updated: totalUpdated, logs });
    }

    for (const person of people) {
      log("info", `  → ${person.name}`);

      const { data: pAccs } = await sb.from("accounts")
        .select("id, currency").eq("person_id", person.id);

      let stocksEur = 0;
      if (pAccs?.length) {
        for (const a of pAccs) {
          const { data: snap } = await sb.from("daily_snapshots")
            .select("portfolio_value, fx_rate").eq("account_id", a.id)
            .lte("date", targetDate).order("date", { ascending: false }).limit(1);
          const s = snap?.[0];
          if (!s) continue;
          const ptfNative = Number(s.portfolio_value);
          const fx = a.currency === "USD" ? Number(s.fx_rate || fxUsdEur) : 1;
          stocksEur += ptfNative * fx;
        }
      }

      const { data: banks } = await sb.from("bank_accounts")
        .select("balance, currency").eq("person_id", person.id);
      let bankEur = 0;
      for (const b of (banks || [])) {
        const fx = b.currency === "EUR" ? 1 : (allFxRates[`${b.currency}EUR`] || 1);
        bankEur += Number(b.balance || 0) * fx;
      }

      const { data: props } = await sb.from("properties")
        .select("current_value, ownership_pct, currency").eq("person_id", person.id);
      let realEstateEur = 0;
      for (const p of (props || [])) {
        const fx = p.currency === "EUR" ? 1 : (allFxRates[`${p.currency}EUR`] || 1);
        realEstateEur += Number(p.current_value || 0) * (Number(p.ownership_pct || 100) / 100) * fx;
      }

      const { data: ls } = await sb.from("loans")
        .select("current_balance, currency").eq("person_id", person.id);
      let loansEur = 0;
      for (const l of (ls || [])) {
        const fx = l.currency === "EUR" ? 1 : (allFxRates[`${l.currency}EUR`] || 1);
        loansEur += Number(l.current_balance || 0) * fx;
      }

      const netEur = stocksEur + bankEur + realEstateEur - loansEur;

      log("info", `    stocks=${stocksEur.toFixed(0)} bank=${bankEur.toFixed(0)} re=${realEstateEur.toFixed(0)} loans=${loansEur.toFixed(0)} net=${netEur.toFixed(0)}€`);

      const { error: nwErr } = await sb.from("networth_snapshots").upsert({
        person_id: person.id,
        date: targetDate,
        currency: "EUR",
        stocks: Math.round(stocksEur * 100) / 100,
        bank: Math.round(bankEur * 100) / 100,
        real_estate: Math.round(realEstateEur * 100) / 100,
        loans: Math.round(loansEur * 100) / 100,
        net: Math.round(netEur * 100) / 100,
        fx_rates: allFxRates,
        source: force ? "manual" : "auto",
      }, { onConflict: "person_id,date,currency" });

      if (nwErr) log("error", `  ${person.name}: ${nwErr.message}`);
    }

    return NextResponse.json({ ok: true, date: targetDate, updated: totalUpdated, logs });
  } catch (e: any) {
    log("error", e.message || String(e));
    return NextResponse.json({ ok: false, error: e.message, logs: [{ level: "error" as const, msg: e.message }] }, { status: 500 });
  }
}