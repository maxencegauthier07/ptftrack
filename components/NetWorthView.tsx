"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  XAxis, YAxis, Tooltip, ResponsiveContainer,
  Area, AreaChart,
} from "recharts";
import { supabase } from "@/lib/supabase";
import type { FxRate, CashMovement } from "@/lib/types";
import { TrendingUp, Landmark, Home, CreditCard, ArrowUpRight, ArrowDownRight } from "lucide-react";
import Sparkline from "./Sparkline";
import GoalCard from "./GoalCard";
import DividendsTracker from "./DividendsTracker";

const fmt = (n: number | null | undefined, d = 0) =>
  n == null ? "—" : Number(n).toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtSign = (n: number, d = 0) => (n >= 0 ? "+" : "") + fmt(n, d);

type NwSnapshot = {
  date: string;
  stocks: number;
  bank: number;
  real_estate: number;
  loans: number;
  net: number;
};

const PERIODS = [
  { key: "7D",  label: "7j",   days: 7 },
  { key: "1M",  label: "1M",   days: 30 },
  { key: "3M",  label: "3M",   days: 90 },
  { key: "YTD", label: "YTD",  days: 0 },
  { key: "1Y",  label: "1A",   days: 365 },
  { key: "ALL", label: "Tout", days: 99999 },
];

export default function NetWorthView({ personId }: { personId: string }) {
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [fxRates, setFxRates] = useState<FxRate[]>([]);
  const [snapshots, setSnapshots] = useState<NwSnapshot[]>([]);
  const [cashMovements, setCashMovements] = useState<CashMovement[]>([]);
  const [period, setPeriod] = useState("1M");

  const notify = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2500); };

  const load = useCallback(async () => {
    setLoading(true);

    // Récupère les account_ids pour filtrer les cashMovements (utilisé par GoalCard)
    const { data: accs } = await supabase.from("accounts").select("id").eq("person_id", personId);
    const accIds = (accs || []).map(a => a.id);

    const [fxR, nwR, cmR] = await Promise.all([
      supabase.from("fx_rates").select("*").order("date", { ascending: false }).limit(50),
      supabase.from("networth_snapshots").select("*").eq("person_id", personId)
        .eq("currency", "EUR").order("date", { ascending: true }).limit(2000),
      accIds.length
        ? supabase.from("cash_movements").select("*").in("account_id", accIds)
        : Promise.resolve({ data: [] as any }),
    ]);

    setFxRates((fxR.data || []) as FxRate[]);
    setSnapshots((nwR.data || []) as NwSnapshot[]);
    setCashMovements((cmR.data || []) as CashMovement[]);
    setLoading(false);
  }, [personId]);

  useEffect(() => { load(); }, [load]);

  // FX map gardée uniquement pour le footer d'info (les snapshots sont déjà en EUR)
  const fxMap = useMemo(() => {
    const m: Record<string, number> = { EUR: 1 };
    const byPair: Record<string, FxRate> = {};
    for (const r of fxRates) {
      if (!byPair[r.pair] || r.date > byPair[r.pair].date) byPair[r.pair] = r;
    }
    if (byPair["USDEUR"]) m["USD"] = Number(byPair["USDEUR"].rate);
    if (byPair["CADEUR"]) m["CAD"] = Number(byPair["CADEUR"].rate);
    if (byPair["AUDEUR"]) m["AUD"] = Number(byPair["AUDEUR"].rate);
    return m;
  }, [fxRates]);

  // ★ SOURCE DE VÉRITÉ : dernier networth_snapshot (déjà en EUR consolidé)
  const latestSnap = useMemo(() => {
    if (snapshots.length === 0) return null;
    return snapshots[snapshots.length - 1];
  }, [snapshots]);

  const totalsEur = useMemo(() => ({
    stocks:     Number(latestSnap?.stocks || 0),
    bank:       Number(latestSnap?.bank || 0),
    realEstate: Number(latestSnap?.real_estate || 0),
    loans:      Number(latestSnap?.loans || 0),
  }), [latestSnap]);

  const grandTotalEur = Number(latestSnap?.net || 0);

  const sparkSeries = useMemo(() => {
    const last30 = snapshots.slice(-30);
    return {
      stocks:     last30.map(s => Number(s.stocks)),
      bank:       last30.map(s => Number(s.bank)),
      realEstate: last30.map(s => Number(s.real_estate)),
      loans:      last30.map(s => Number(s.loans)),
    };
  }, [snapshots]);

  const chartData = useMemo(() => {
    if (snapshots.length === 0) return [];
    const p = PERIODS.find(x => x.key === period) || PERIODS[1];
    let filtered = snapshots;
    if (p.key === "ALL") {
      filtered = snapshots;
    } else if (p.key === "YTD") {
      const year = new Date().getFullYear();
      filtered = snapshots.filter(s => s.date >= `${year}-01-01`);
    } else {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - p.days);
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      filtered = snapshots.filter(s => s.date >= cutoffStr);
    }
    return filtered.map(s => ({
      date: s.date,
      net: Number(s.net),
      stocks: Number(s.stocks),
      bank: Number(s.bank),
      realEstate: Number(s.real_estate),
      loans: Number(s.loans),
    }));
  }, [snapshots, period]);

  const variations = useMemo(() => {
    if (snapshots.length === 0) return null;
    const last = snapshots[snapshots.length - 1];
    const prev = snapshots.length >= 2 ? snapshots[snapshots.length - 2] : null;
    const periodStart = chartData[0];
    const dayDelta = prev ? Number(last.net) - Number(prev.net) : null;
    const periodDelta = periodStart ? Number(last.net) - Number(periodStart.net) : null;
    const periodDeltaPct = periodStart && Number(periodStart.net) !== 0
      ? (periodDelta! / Number(periodStart.net)) * 100
      : null;
    return { dayDelta, periodDelta, periodDeltaPct, lastDate: last.date };
  }, [snapshots, chartData]);

  if (loading) {
    return <div className="flex items-center justify-center py-24"><span className="font-mono text-[var(--text-3)] text-sm">loading...</span></div>;
  }

  const isEmpty = !latestSnap;

  return (
    <div className="px-5 py-6 max-w-[1280px] mx-auto">
      {toast && <div className="fixed top-3 right-3 z-50 bg-[var(--green)] text-white py-2 px-4 rounded-md text-xs font-mono animate-fade-up shadow-lg">{toast}</div>}
      {isEmpty ? (
        <div className="card-static py-24 text-center">
          <div className="text-[var(--text-2)] text-sm mb-1">Pas encore de snapshot patrimoine</div>
          <div className="text-[var(--text-3)] text-xs font-mono">Lance un update sur l&apos;onglet Stocks pour générer le premier</div>
        </div>
      ) : (
        <>
          {/* HERO */}
          <div className="mb-8">
            <div className="text-[var(--text-3)] text-xs font-medium uppercase tracking-wider mb-2">Patrimoine net</div>
            <div className="flex items-baseline gap-4 flex-wrap mb-2">
              <div className="font-mono font-semibold tracking-tight text-[var(--text-1)]" style={{ fontSize: "44px", lineHeight: 1.1 }}>
                {fmt(grandTotalEur, 0)}<span className="text-[var(--text-3)] text-2xl ml-1.5 font-normal">€</span>
              </div>
              {variations?.dayDelta != null && (
                <div className="inline-flex items-center gap-1.5 text-sm font-mono">
                  {variations.dayDelta >= 0 ? (
                    <ArrowUpRight size={16} className="text-[var(--green)]" />
                  ) : (
                    <ArrowDownRight size={16} className="text-[var(--red)]" />
                  )}
                  <span style={{ color: variations.dayDelta >= 0 ? "var(--green)" : "var(--red)" }} className="font-semibold">
                    {fmtSign(variations.dayDelta)}€
                  </span>
                  <span className="text-[var(--text-3)] text-xs">aujourd&apos;hui</span>
                </div>
              )}
            </div>
            {variations?.periodDelta != null && period !== "ALL" && (
              <div className="text-xs text-[var(--text-3)] font-mono">
                <span style={{ color: variations.periodDelta >= 0 ? "var(--green)" : "var(--red)" }} className="font-semibold">
                  {fmtSign(variations.periodDelta)}€
                </span>
                {variations.periodDeltaPct != null && (
                  <span style={{ color: variations.periodDelta >= 0 ? "var(--green)" : "var(--red)" }}>
                    {" "}({fmtSign(variations.periodDeltaPct, 2)}%)
                  </span>
                )}
                <span className="ml-1.5">sur {PERIODS.find(p => p.key === period)?.label.toLowerCase()}</span>
              </div>
            )}
            <div className="text-[10px] text-[var(--text-4)] font-mono mt-1.5">
              dernier snapshot · {latestSnap?.date}
            </div>
          </div>

          {/* ★ GOAL CARD */}
          <GoalCard
            personId={personId}
            currentNet={grandTotalEur}
            snapshots={snapshots}
            cashMovements={cashMovements}
            onNotify={notify}
          />

          {/* GRAPH */}
          <div className="card-static p-5 mb-6">
            <div className="flex items-center justify-between mb-4">
              <div className="text-sm font-semibold text-[var(--text-1)]">Évolution</div>
              <div className="flex gap-0.5 bg-[var(--bg-overlay)] rounded-md p-0.5">
                {PERIODS.map(p => (
                  <button key={p.key} onClick={() => setPeriod(p.key)}
                    className={`py-1 px-2.5 rounded text-[11px] font-medium transition-all
                      ${period === p.key
                        ? "bg-[var(--bg-raised)] text-[var(--text-1)]"
                        : "text-[var(--text-3)] hover:text-[var(--text-2)]"}`}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            {chartData.length === 0 ? (
              <div className="py-16 text-center text-[var(--text-3)] text-xs font-mono">
                Pas encore de snapshot. Lance un update sur l&apos;onglet Stocks pour générer le premier.
              </div>
            ) : chartData.length === 1 ? (
              <div className="py-16 text-center text-[var(--text-3)] text-xs font-mono">
                1 seul snapshot — il faut au moins 2 jours pour un graph
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={chartData} margin={{ top: 5, right: 4, left: 4, bottom: 5 }}>
                  <defs>
                    <linearGradient id="nwGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.18} />
                      <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: "var(--text-3)" }}
                    tickFormatter={d => {
                      const dt = new Date(d);
                      return dt.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
                    }}
                    axisLine={false} tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "var(--text-3)" }}
                    axisLine={false} tickLine={false}
                    tickFormatter={v => `${(v / 1000).toFixed(0)}k`}
                    domain={["auto", "auto"]}
                  />
                  <Tooltip content={<NwTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="net"
                    stroke="var(--accent)"
                    strokeWidth={2}
                    fill="url(#nwGradient)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* CATEGORY CARDS avec sparklines */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <CategoryCard label="Actions" value={totalsEur.stocks}
              color="var(--cat-stocks)" icon={TrendingUp}
              series={sparkSeries.stocks} />
            <CategoryCard label="Banque" value={totalsEur.bank}
              color="var(--cat-bank)" icon={Landmark}
              series={sparkSeries.bank} />
            <CategoryCard label="Immo" value={totalsEur.realEstate}
              color="var(--cat-realestate)" icon={Home}
              series={sparkSeries.realEstate} />
            <CategoryCard label="Dettes" value={totalsEur.loans}
              color="var(--cat-loans)" icon={CreditCard}
              series={sparkSeries.loans} isDebt />
          </div>

          {/* ★ DIVIDENDS (compact) */}
          <DividendsTracker personId={personId} compact onNotify={notify} />

          {/* RÉPARTITION */}
          <div className="card-static p-5 mb-6">
            <div className="text-sm font-semibold text-[var(--text-1)] mb-4">Répartition des actifs</div>
            {(() => {
              const totalAssets = totalsEur.stocks + totalsEur.bank + totalsEur.realEstate;
              if (totalAssets <= 0) return <div className="text-[var(--text-3)] text-xs font-mono">Aucun actif</div>;
              const segs = [
                { label: "Actions", value: totalsEur.stocks, color: "var(--cat-stocks)" },
                { label: "Banque",  value: totalsEur.bank,   color: "var(--cat-bank)" },
                { label: "Immo",    value: totalsEur.realEstate, color: "var(--cat-realestate)" },
              ].filter(s => s.value > 0);
              return (
                <>
                  <div className="h-2 flex rounded-full overflow-hidden mb-4 bg-[var(--bg-overlay)]">
                    {segs.map(s => (
                      <div key={s.label} style={{ width: `${(s.value / totalAssets) * 100}%`, background: s.color }} />
                    ))}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {segs.map(s => (
                      <div key={s.label}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />
                          <span className="text-[var(--text-2)] text-xs">{s.label}</span>
                        </div>
                        <div className="text-[var(--text-1)] font-mono font-semibold text-base ml-4">
                          {((s.value / totalAssets) * 100).toFixed(1)}%
                        </div>
                        <div className="text-[var(--text-3)] font-mono text-[11px] ml-4">
                          {fmt(s.value, 0)}€
                        </div>
                      </div>
                    ))}
                  </div>
                  {totalsEur.loans > 0 && (
                    <div className="mt-5 pt-4 border-t border-[var(--border)] flex items-baseline justify-between">
                      <span className="text-xs text-[var(--text-2)]">Taux d&apos;endettement</span>
                      <span className="font-mono text-sm">
                        <span className="text-[var(--red)] font-semibold">
                          {((totalsEur.loans / totalAssets) * 100).toFixed(1)}%
                        </span>
                        <span className="text-[var(--text-4)] text-xs ml-2">
                          {fmt(totalsEur.loans, 0)}€ dette / {fmt(totalAssets, 0)}€ actifs
                        </span>
                      </span>
                    </div>
                  )}
                </>
              );
            })()}
          </div>

          {Object.keys(fxMap).length > 1 && (
            <div className="text-[10px] text-[var(--text-4)] font-mono text-center">
              {Object.entries(fxMap).filter(([k]) => k !== "EUR").map(([k, v]) => `1 ${k} = ${fmt(v, 4)}€`).join(" · ")}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CategoryCard({ label, value, color, icon: Ico, series, isDebt }: any) {
  const displayValue = isDebt ? -value : value;
  const trend = useMemo(() => {
    if (!series || series.length < 2) return null;
    const first = series[0];
    const last = series[series.length - 1];
    if (first === 0) return null;
    const delta = last - first;
    const pct = (delta / Math.abs(first)) * 100;
    const isGood = isDebt ? delta < 0 : delta > 0;
    return { delta, pct, isGood };
  }, [series, isDebt]);
  const trendColor = trend?.isGood ? "var(--green)" : "var(--red)";
  return (
    <div className="card-static p-4 relative overflow-hidden">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[var(--text-3)] text-[10px] font-medium uppercase tracking-wider">{label}</span>
        <Ico size={14} style={{ color }} />
      </div>
      <div className="font-mono font-semibold tracking-tight text-[var(--text-1)]" style={{ fontSize: "20px" }}>
        {fmtSign(displayValue, 0)}<span className="text-[var(--text-3)] text-xs ml-1 font-normal">€</span>
      </div>
      <div className="flex items-center justify-between mt-2 gap-2">
        {trend ? (
          <span className="text-[10px] font-mono" style={{ color: trendColor }}>
            {trend.delta >= 0 ? "+" : ""}{fmt(Math.abs(trend.pct), 1)}% <span className="text-[var(--text-4)]">30j</span>
          </span>
        ) : (
          <span className="text-[10px] text-[var(--text-4)] font-mono">—</span>
        )}
        <Sparkline data={series || []} width={70} height={24} color={color} />
      </div>
    </div>
  );
}

function NwTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="bg-[var(--bg-raised)] border border-[var(--border-2)] rounded-lg py-2.5 px-3.5 text-xs font-mono shadow-lg">
      <div className="text-[var(--text-3)] mb-1.5">{label}</div>
      <div className="text-[var(--text-1)] font-semibold mb-2">{fmt(p.net, 0)}€</div>
      <div className="space-y-0.5 text-[10px]">
        {p.stocks > 0 && <div className="flex justify-between gap-4"><span className="text-[var(--text-3)]">Actions</span><span className="text-[var(--text-2)]">{fmt(p.stocks, 0)}€</span></div>}
        {p.bank > 0 && <div className="flex justify-between gap-4"><span className="text-[var(--text-3)]">Banque</span><span className="text-[var(--text-2)]">{fmt(p.bank, 0)}€</span></div>}
        {p.realEstate > 0 && <div className="flex justify-between gap-4"><span className="text-[var(--text-3)]">Immo</span><span className="text-[var(--text-2)]">{fmt(p.realEstate, 0)}€</span></div>}
        {p.loans > 0 && <div className="flex justify-between gap-4"><span className="text-[var(--text-3)]">Dettes</span><span className="text-[var(--red)]">−{fmt(p.loans, 0)}€</span></div>}
      </div>
    </div>
  );
}
