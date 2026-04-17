import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import {
  fetchAllFxRates,
  fetchHistoryBatch,
  fetchFxHistory,
  BENCHMARK,
} from "@/lib/yahoo";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

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

/**
 * Rebuild complet de l'historique des snapshots d'une personne à partir de :
 * - Ses trades (BUY/SELL) pour reconstituer les holdings à chaque date
 * - Ses cash_movements pour reconstituer le cash à chaque date
 * - Les prix historiques Yahoo pour valoriser chaque jour
 *
 * Usage : GET /api/rebuild?person_id=XXX&from=2025-12-31&to=2026-04-17
 *
 * ⚠️ Supprime TOUS les daily_snapshots + networth_snapshots de cette personne
 *    dans l'intervalle [from, to] avant de les reconstruire proprement.
 */
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

    const personId = req.nextUrl.searchParams.get("person_id");
    const fromDate = req.nextUrl.searchParams.get("from");
    const toDate = req.nextUrl.searchParams.get("to") || new Date().toISOString().slice(0, 10);

    if (!personId) return NextResponse.json({ error: "person_id requis" }, { status: 400 });
    if (!fromDate) return NextResponse.json({ error: "from requis (format YYYY-MM-DD)" }, { status: 400 });

    log("info", `Rebuild ${personId} de ${fromDate} à ${toDate}`);

    // 1. FX live (pour référence) + historique
    const allFxRates = await fetchAllFxRates();
    const fxUsdEur = allFxRates["USDEUR"] || 0.87;

    // 2. Charger tous les comptes de la personne
    const { data: accounts } = await sb.from("accounts")
      .select("*, people(name)").eq("person_id", personId);
    if (!accounts?.length) return NextResponse.json({ error: "Pas de comptes" }, { status: 404 });

    const accountIds = accounts.map(a => a.id);

    // 3. Supprimer les snapshots existants dans l'intervalle
    await sb.from("daily_snapshots").delete()
      .in("account_id", accountIds).gte("date", fromDate).lte("date", toDate);
    await sb.from("networth_snapshots").delete()
      .eq("person_id", personId).gte("date", fromDate).lte("date", toDate);
    log("info", "Anciens snapshots supprimés");

    // 4. Charger tous les trades + cash_movements de la personne
    const { data: trades } = await sb.from("trades").select("*")
      .in("account_id", accountIds).order("date", { ascending: true });
    const { data: cashMovs } = await sb.from("cash_movements").select("*")
      .in("account_id", accountIds).order("date", { ascending: true });

    log("info", `Trades: ${trades?.length || 0}, cash_movements: ${cashMovs?.length || 0}`);

    // 5. Calculer le nombre de jours à rebuild pour fetcher les bons historiques
    const daysNeeded = tradingDays(fromDate, toDate);
    const daysBack = Math.max(daysNeeded.length + 30, 30);

    // 6. Pour chaque compte, reconstruire son historique
    const bankData = await sb.from("bank_accounts").select("balance, currency").eq("person_id", personId);
    const propData = await sb.from("properties").select("current_value, ownership_pct, currency").eq("person_id", personId);
    const loanData = await sb.from("loans").select("current_balance, currency").eq("person_id", personId);

    // NW cumulatifs par date
    const nwByDate: Record<string, { stocks: number; bank: number; realEstate: number; loans: number }> = {};

    for (const acc of accounts) {
      const who = (acc as any).people?.name || "?";
      const isCto = acc.currency === "USD";
      log("info", `── ${who} ${acc.type} (${acc.currency}) ──`);

      // Trades et cash de CE compte, triés par date
      const accTrades = (trades || []).filter(t => t.account_id === acc.id);
      const accCash = (cashMovs || []).filter(c => c.account_id === acc.id);

      // Tous les tickers que Pierre a eu sur ce compte (pour fetch historique)
      const tickersEver = Array.from(new Set(accTrades.map(t => t.ticker)));
      const benchTicker = BENCHMARK[acc.benchmark];
      const allTickers = [...tickersEver, ...(benchTicker ? [benchTicker] : [])];

      if (!allTickers.length) {
        log("info", "  Pas de trades, skip");
        continue;
      }

      // Fetch prix historiques pour tous ces tickers
      const [histories, fxHistory] = await Promise.all([
        fetchHistoryBatch(allTickers, daysBack),
        fetchFxHistory(daysBack),
      ]);

      const tickerCurrency = (ticker: string): string => {
        if (ticker.endsWith(".AX")) return "AUD";
        if (ticker.endsWith(".PA") || ticker.endsWith(".BR") || ticker.endsWith(".DE")) return "EUR";
        if (ticker.endsWith(".L")) return "GBP";
        if (ticker.endsWith(".TO") || ticker.endsWith(".V")) return "CAD";
        return "USD";
      };

      const toAccountCcy = (price: number, ticker: string, dayFxRate: number): number => {
        const priceCcy = tickerCurrency(ticker);
        if (priceCcy === acc.currency) return price;

        const usdeur = dayFxRate;
        const audeur = allFxRates["AUDEUR"] || 0.61;
        const cadeur = allFxRates["CADEUR"] || 0.63;

        let priceEur = price;
        if (priceCcy === "USD") priceEur = price * usdeur;
        else if (priceCcy === "AUD") priceEur = price * audeur;
        else if (priceCcy === "CAD") priceEur = price * cadeur;

        if (acc.currency === "EUR") return priceEur;
        if (acc.currency === "USD") return usdeur > 0 ? priceEur / usdeur : priceEur;
        return priceEur;
      };

      let prevIndexAdj: number | null = null;
      let prevIndexRaw: number | null = null;

      for (const day of daysNeeded) {
        // Reconstituer les holdings à cette date :
        // shares(ticker, day) = sum(BUY.shares) - sum(SELL.shares) pour trades <= day
        const sharesByTicker: Record<string, number> = {};
        for (const t of accTrades) {
          if (t.date > day) break;
          const delta = t.side === "BUY" ? Number(t.shares) : -Number(t.shares);
          sharesByTicker[t.ticker] = (sharesByTicker[t.ticker] || 0) + delta;
        }

        // Valoriser chaque position avec le prix du jour
        const fxRate = pickPrice(fxHistory, day, fxUsdEur);
        let positionsValue = 0;
        for (const [ticker, shares] of Object.entries(sharesByTicker)) {
          if (shares <= 0) continue;
          const hist = histories.get(ticker);
          const rawPrice = hist ? pickPrice(hist, day, 0) : 0;
          if (rawPrice <= 0) continue;
          const price = toAccountCcy(rawPrice, ticker, fxRate);
          positionsValue += shares * price;
        }

        // Cash à cette date = somme des cash_movements + delta des trades
        let cashEur = 0;
        for (const cm of accCash) {
          if (cm.date > day) break;
          cashEur += Number(cm.amount);
        }
        for (const t of accTrades) {
          if (t.date > day) break;
          // Pour les trades, on convertit en EUR avec le fx_rate du jour DU TRADE
          // Simplification : on prend fx actuel — suffisant pour reconstitution
          const tFx = acc.currency === "USD" ? fxUsdEur : 1;
          const cost = Number(t.price) * Number(t.shares) + Number(t.fees || 0);
          const costEur = tickerCurrency(t.ticker) === "USD" ? cost * fxUsdEur : cost;
          cashEur += t.side === "BUY" ? -costEur : costEur;
        }

        let ptfValue: number;
        if (isCto) {
          ptfValue = positionsValue + (fxRate > 0 ? cashEur / fxRate : 0);
        } else {
          ptfValue = positionsValue + cashEur;
        }

        // Index (benchmark)
        const benchHist = benchTicker ? histories.get(benchTicker) : undefined;
        let indexRaw = benchHist ? pickPrice(benchHist, day, 0) : 0;

        const { data: deposits } = await sb.from("cash_movements")
          .select("amount").eq("account_id", acc.id).eq("date", day);
        const totalDepositEur = (deposits || []).reduce((s: number, d: any) => s + Number(d.amount), 0);
        const depositNative = isCto && fxRate > 0 ? totalDepositEur / fxRate : totalDepositEur;

        let indexAdj: number;
        if (prevIndexAdj !== null && indexRaw > 0 && prevIndexRaw && prevIndexRaw > 0) {
          const dailyReturn = indexRaw / prevIndexRaw;
          indexAdj = prevIndexAdj * dailyReturn + depositNative;
        } else if (prevIndexAdj !== null) {
          indexAdj = prevIndexAdj + depositNative;
        } else {
          indexAdj = ptfValue;
        }

        prevIndexAdj = indexAdj;
        prevIndexRaw = indexRaw > 0 ? indexRaw : prevIndexRaw;

        // Écrire le snapshot
        await sb.from("daily_snapshots").upsert({
          account_id: acc.id, date: day,
          portfolio_value: Math.round(ptfValue * 100) / 100,
          index_value: Math.round(indexAdj * 100) / 100,
          index_raw: Math.round(indexRaw * 100) / 100,
          cash: Math.round(cashEur * 100) / 100,
          fx_rate: fxRate, confirmed: true,
        }, { onConflict: "account_id,date" });

        // Cumul pour networth
        const ptfEur = isCto ? ptfValue * fxRate : ptfValue;
        if (!nwByDate[day]) nwByDate[day] = { stocks: 0, bank: 0, realEstate: 0, loans: 0 };
        nwByDate[day].stocks += ptfEur;

        if (day === daysNeeded[0] || day === daysNeeded[daysNeeded.length - 1]) {
          log("info", `  ${day}: ptf=${ptfValue.toFixed(0)} cash=${cashEur.toFixed(0)}`);
        }
      }
    }

    // 7. Calculer les networth_snapshots (bank/immo/loans sont pris en valeur actuelle — simplification)
    let bankEur = 0;
    for (const b of (bankData.data || [])) {
      const fx = b.currency === "EUR" ? 1 : (allFxRates[`${b.currency}EUR`] || 1);
      bankEur += Number(b.balance || 0) * fx;
    }
    let realEstateEur = 0;
    for (const p of (propData.data || [])) {
      const fx = p.currency === "EUR" ? 1 : (allFxRates[`${p.currency}EUR`] || 1);
      realEstateEur += Number(p.current_value || 0) * (Number(p.ownership_pct || 100) / 100) * fx;
    }
    let loansEur = 0;
    for (const l of (loanData.data || [])) {
      const fx = l.currency === "EUR" ? 1 : (allFxRates[`${l.currency}EUR`] || 1);
      loansEur += Number(l.current_balance || 0) * fx;
    }

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

    log("info", `✓ Rebuild terminé — ${Object.keys(nwByDate).length} jours`);

    return NextResponse.json({ ok: true, days: Object.keys(nwByDate).length, logs });
  } catch (e: any) {
    log("error", e.message || String(e));
    return NextResponse.json({ ok: false, error: e.message, logs }, { status: 500 });
  }
}