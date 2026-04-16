"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import type { Dividend, Account } from "@/lib/types";
import { Coins, TrendingUp, Trash2 } from "lucide-react";

const fmt = (n: number | null | undefined, d = 0) =>
  n == null ? "—" : Number(n).toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });

const MONTHS = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep", "Oct", "Nov", "Déc"];

type Props = {
  personId: string;
  compact?: boolean;       // version réduite pour mettre dans Net Worth
  onNotify?: (m: string) => void;
};

export default function DividendsTracker({ personId, compact = false, onNotify }: Props) {
  const [loading, setLoading] = useState(true);
  const [dividends, setDividends] = useState<Dividend[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: accs } = await supabase.from("accounts").select("*").eq("person_id", personId);
    const accIds = (accs || []).map(a => a.id);
    setAccounts((accs || []) as Account[]);

    if (!accIds.length) { setDividends([]); setLoading(false); return; }

    const { data } = await supabase.from("dividends")
      .select("*")
      .in("account_id", accIds)
      .order("date", { ascending: false })
      .limit(500);
    setDividends((data || []) as Dividend[]);
    setLoading(false);
  }, [personId]);

  useEffect(() => { load(); }, [load]);

  const del = async (d: Dividend) => {
    if (!confirm(`Supprimer ce dividende de ${fmt(d.amount)}€ ?`)) return;
    await supabase.from("dividends").delete().eq("id", d.id);
    onNotify?.("✓ Dividende supprimé");
    load();
  };

  const stats = useMemo(() => {
    const thisYear = new Date().getFullYear();
    const lastYear = thisYear - 1;
    const thisMonth = new Date().getMonth(); // 0-11

    const byYear: Record<number, number> = {};
    const byMonthThisYear = new Array(12).fill(0);
    const byTicker: Record<string, number> = {};

    for (const d of dividends) {
      const amt = Number(d.amount);
      const dt = new Date(d.date);
      const y = dt.getFullYear();
      byYear[y] = (byYear[y] || 0) + amt;
      if (y === thisYear) byMonthThisYear[dt.getMonth()] += amt;
      const t = d.ticker || "Autres";
      byTicker[t] = (byTicker[t] || 0) + amt;
    }

    const ytd = byYear[thisYear] || 0;
    const lastYearTotal = byYear[lastYear] || 0;

    // Run-rate YTD (projection annuelle basée sur la période écoulée)
    const daysInYear = 365;
    const dayOfYear = Math.floor((Date.now() - new Date(thisYear, 0, 1).getTime()) / 86400000) + 1;
    const ytdProjection = dayOfYear > 0 ? (ytd / dayOfYear) * daysInYear : 0;

    // Top tickers
    const topTickers = Object.entries(byTicker)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    // Meilleur mois (month max)
    const maxMonth = Math.max(...byMonthThisYear);

    return {
      ytd, lastYearTotal, ytdProjection,
      byMonthThisYear, maxMonth,
      topTickers,
      total: dividends.reduce((s, d) => s + Number(d.amount), 0),
      count: dividends.length,
      thisYear,
    };
  }, [dividends]);

  if (loading) return null;

  const hasData = dividends.length > 0;

  // Mode compact (pour Net Worth) : juste un bandeau résumé
  if (compact) {
    if (!hasData) return null;
    return (
      <div className="card-static p-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Coins size={14} className="text-[var(--amber)]" />
            <span className="text-[var(--text-1)] text-sm font-semibold">Dividendes {stats.thisYear}</span>
          </div>
          <div className="text-[var(--text-3)] text-[10px] font-mono">
            {dividends.length} versement{dividends.length > 1 ? "s" : ""}
          </div>
        </div>

        <div className="flex items-baseline gap-3 mb-3">
          <div className="font-mono font-semibold text-[var(--text-1)]" style={{ fontSize: "22px" }}>
            {fmt(stats.ytd, 0)}€
          </div>
          {stats.lastYearTotal > 0 && (
            <div className="text-[11px] font-mono text-[var(--text-3)]">
              {stats.lastYearTotal > 0 && (
                <>vs {fmt(stats.lastYearTotal, 0)}€ en {stats.thisYear - 1}</>
              )}
            </div>
          )}
        </div>

        {/* Mini bar chart mensuel */}
        <div className="flex items-end gap-0.5 h-12 mb-1">
          {stats.byMonthThisYear.map((v, i) => {
            const h = stats.maxMonth > 0 ? (v / stats.maxMonth) * 100 : 0;
            const isCurrentMonth = i === new Date().getMonth();
            return (
              <div key={i} className="flex-1 flex flex-col items-center justify-end h-full gap-0.5" title={`${MONTHS[i]} : ${fmt(v, 0)}€`}>
                <div
                  className="w-full rounded-t transition-all"
                  style={{
                    height: `${Math.max(h, v > 0 ? 4 : 0)}%`,
                    background: isCurrentMonth ? "var(--amber)" : "var(--text-4)",
                    opacity: v > 0 ? 1 : 0.3,
                  }}
                />
              </div>
            );
          })}
        </div>
        <div className="flex gap-0.5 text-[8px] font-mono text-[var(--text-4)]">
          {MONTHS.map((m, i) => (
            <div key={m} className="flex-1 text-center">{m.slice(0, 1)}</div>
          ))}
        </div>

        {stats.ytdProjection > stats.ytd && (
          <div className="mt-3 pt-2.5 border-t border-[var(--border)] flex items-center gap-1.5 text-[10px] text-[var(--text-3)] font-mono">
            <TrendingUp size={10} />
            Projection fin d&apos;année : <span className="text-[var(--text-2)]">{fmt(stats.ytdProjection, 0)}€</span>
          </div>
        )}
      </div>
    );
  }

  // Mode complet : liste + stats détaillées
  return (
    <div>
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <StatCard label={`Reçus ${stats.thisYear}`} value={`${fmt(stats.ytd, 0)}€`} />
        <StatCard label={`Projection ${stats.thisYear}`} value={`${fmt(stats.ytdProjection, 0)}€`} subtle />
        <StatCard label={`Total ${stats.thisYear - 1}`} value={`${fmt(stats.lastYearTotal, 0)}€`} subtle />
        <StatCard label="Total historique" value={`${fmt(stats.total, 0)}€`} subtle />
      </div>

      {/* Graph mensuel */}
      {hasData && (
        <div className="card-static p-5 mb-5">
          <div className="text-sm font-semibold text-[var(--text-1)] mb-4">Par mois — {stats.thisYear}</div>
          <div className="flex items-end gap-1 h-32 mb-2">
            {stats.byMonthThisYear.map((v, i) => {
              const h = stats.maxMonth > 0 ? (v / stats.maxMonth) * 100 : 0;
              const isCurrent = i === new Date().getMonth();
              return (
                <div key={i} className="flex-1 flex flex-col items-center justify-end h-full gap-1"
                  title={`${MONTHS[i]} : ${fmt(v, 0)}€`}>
                  <div className="text-[9px] font-mono text-[var(--text-3)] h-3">
                    {v > 0 ? fmt(v, 0) : ""}
                  </div>
                  <div
                    className="w-full rounded-t transition-all"
                    style={{
                      height: `${Math.max(h, v > 0 ? 4 : 0)}%`,
                      background: isCurrent ? "var(--amber)" : "var(--accent)",
                      opacity: v > 0 ? (isCurrent ? 1 : 0.6) : 0.15,
                    }}
                  />
                </div>
              );
            })}
          </div>
          <div className="flex gap-1 text-[10px] font-mono text-[var(--text-3)] text-center">
            {MONTHS.map(m => <div key={m} className="flex-1">{m}</div>)}
          </div>
        </div>
      )}

      {/* Top tickers */}
      {stats.topTickers.length > 0 && (
        <div className="card-static p-5 mb-5">
          <div className="text-sm font-semibold text-[var(--text-1)] mb-3">Top payeurs</div>
          <div className="space-y-2">
            {stats.topTickers.map(([ticker, amt]) => {
              const pct = stats.total > 0 ? (amt / stats.total) * 100 : 0;
              return (
                <div key={ticker}>
                  <div className="flex justify-between items-baseline mb-1">
                    <span className="text-[var(--text-1)] font-mono text-sm font-medium">{ticker}</span>
                    <span className="text-[var(--text-2)] font-mono text-xs">{fmt(amt, 0)}€ <span className="text-[var(--text-4)]">({pct.toFixed(1)}%)</span></span>
                  </div>
                  <div className="h-1 bg-[var(--bg-overlay)] rounded-full overflow-hidden">
                    <div className="h-full bg-[var(--amber)] rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Liste */}
      <div className="card-static overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--border)] flex justify-between items-center">
          <span className="text-sm font-semibold text-[var(--text-1)]">Historique</span>
          <span className="text-[var(--text-3)] text-[10px] font-mono">{dividends.length} versement{dividends.length > 1 ? "s" : ""}</span>
        </div>
        {!hasData ? (
          <div className="py-16 text-center text-[var(--text-3)] text-xs font-mono">
            Aucun dividende enregistré. Utilise &quot;+/- Value&quot; dans Stocks avec le toggle &quot;Dividende&quot;.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  {["Date", "Ticker", "Compte", "Montant €", "Devise", "Retenue", ""].map((h, i) => (
                    <th key={h} className={`py-2 px-3 text-[var(--text-3)] font-medium text-[10px] uppercase tracking-wider ${i === 3 || i === 4 || i === 5 ? "text-right" : "text-left"}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dividends.map(d => {
                  const acc = accounts.find(a => a.id === d.account_id);
                  return (
                    <tr key={d.id} className="row-hover border-b border-[var(--border)] last:border-0">
                      <td className="py-2 px-3 font-mono text-[var(--text-2)]">{d.date}</td>
                      <td className="py-2 px-3 font-mono text-[var(--text-1)] font-semibold">{d.ticker || "—"}</td>
                      <td className="py-2 px-3 font-mono text-[var(--text-3)] text-[10px]">{acc?.type || "—"}</td>
                      <td className="py-2 px-3 font-mono text-[var(--amber)] text-right font-semibold">
                        +{fmt(d.amount, 2)}€
                      </td>
                      <td className="py-2 px-3 font-mono text-right text-[var(--text-3)] text-[10px]">
                        {d.amount_native && d.currency_native ? `${fmt(d.amount_native, 2)} ${d.currency_native}` : "—"}
                      </td>
                      <td className="py-2 px-3 font-mono text-right text-[var(--text-3)] text-[10px]">
                        {Number(d.withholding_tax) > 0 ? `−${fmt(d.withholding_tax, 2)}` : "—"}
                      </td>
                      <td className="py-2 px-3 text-right">
                        <button onClick={() => del(d)} className="text-[var(--text-3)] hover:text-[var(--red)]"><Trash2 size={10} /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, subtle }: any) {
  return (
    <div className="card-static p-4">
      <div className="text-[var(--text-3)] text-[10px] font-medium uppercase tracking-wider mb-2">{label}</div>
      <div className={`font-mono font-semibold tracking-tight ${subtle ? "text-[var(--text-2)]" : "text-[var(--text-1)]"}`} style={{ fontSize: "18px" }}>
        {value}
      </div>
    </div>
  );
}