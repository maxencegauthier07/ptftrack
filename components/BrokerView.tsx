"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import type { Account, SubAccount, Holding, FxRate, Broker } from "@/lib/types";

const fmt = (n: number | null | undefined, d = 2) =>
  n == null ? "—" : Number(n).toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });

type BrokerRow = {
  broker_id: string | null;
  broker_name: string;
  broker_color: string;
  sub_account_count: number;
  total_eur: number;
  total_cash_eur: number;
  total_positions_eur: number;
  subAccounts: SubAccount[];
};

export default function BrokerView({ personId }: { personId: string }) {
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [subAccounts, setSubAccounts] = useState<SubAccount[]>([]);
  const [brokers, setBrokers] = useState<Broker[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [fxRates, setFxRates] = useState<FxRate[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: accs } = await supabase.from("accounts").select("*").eq("person_id", personId);
    const accIds = (accs || []).map(a => a.id);

    const [saR, bR, hR, fxR] = await Promise.all([
      accIds.length
        ? supabase.from("sub_accounts").select("*, brokers(name, color)").in("account_id", accIds)
        : Promise.resolve({ data: [] as any }),
      supabase.from("brokers").select("*"),
      supabase.from("holdings").select("*"),
      supabase.from("fx_rates").select("*").order("date", { ascending: false }).limit(50),
    ]);

    setAccounts((accs || []) as Account[]);
    setSubAccounts((saR.data || []) as SubAccount[]);
    setBrokers((bR.data || []) as Broker[]);
    setHoldings((hR.data || []) as Holding[]);
    setFxRates((fxR.data || []) as FxRate[]);
    setLoading(false);
  }, [personId]);

  useEffect(() => { load(); }, [load]);

  const fxUsdEur = useMemo(() => {
    const usd = fxRates.find(r => r.pair === "USDEUR");
    return usd ? Number(usd.rate) : 0.87;
  }, [fxRates]);

  const brokerRows = useMemo<BrokerRow[]>(() => {
    const saIds = new Set(subAccounts.map(sa => sa.id));
    const byBroker: Record<string, BrokerRow> = {};

    for (const sa of subAccounts) {
      const key = sa.broker_id || "__none__";
      if (!byBroker[key]) {
        byBroker[key] = {
          broker_id: sa.broker_id,
          broker_name: sa.brokers?.name || "— Non assigné —",
          broker_color: sa.brokers?.color || "#6b7280",
          sub_account_count: 0,
          total_eur: 0,
          total_cash_eur: 0,
          total_positions_eur: 0,
          subAccounts: [],
        };
      }
      const row = byBroker[key];
      row.subAccounts.push(sa);
      row.sub_account_count++;

      // Cash déjà en EUR
      const cashEur = Number(sa.cash || 0);

      // Positions = shares × last_price, en devise du compte → EUR
      const acc = accounts.find(a => a.id === sa.account_id);
      const subHoldings = holdings.filter(h => h.sub_account_id === sa.id && Number(h.shares) > 0);
      const posNative = subHoldings.reduce((s, h) => s + Number(h.shares) * Number(h.last_price || 0), 0);
      const posEur = acc?.currency === "USD" ? posNative * fxUsdEur : posNative;

      row.total_cash_eur += cashEur;
      row.total_positions_eur += posEur;
      row.total_eur += cashEur + posEur;
    }

    return Object.values(byBroker).sort((a, b) => b.total_eur - a.total_eur);
  }, [subAccounts, holdings, accounts, fxUsdEur]);

  const grandTotal = brokerRows.reduce((s, r) => s + r.total_eur, 0);

  if (loading) {
    return <div className="flex items-center justify-center py-20"><span className="font-mono text-dim text-sm">loading...</span></div>;
  }

  const subAccLabel = (sa: SubAccount) => {
    const b = sa.brokers?.name || "Non assigné";
    return sa.name ? `${b} · ${sa.name}` : b;
  };

  return (
    <div>
      <div className="border-b border-border py-2 px-5 flex items-center justify-between">
        <span className="text-[10px] text-dim uppercase tracking-widest">Par broker</span>
        <span className="text-[11px] font-mono text-muted">Total : <span className="text-bright font-semibold">{fmt(grandTotal, 0)}€</span></span>
      </div>

      <div className="p-4 md:p-5 max-w-[1280px] mx-auto">
        {brokerRows.length === 0 ? (
          <div className="text-dim text-[11px] text-center py-16 font-mono">
            Aucun sub-account. Crée-en dans l&apos;onglet Stocks → Gestion brokers.
          </div>
        ) : (
          <>
            {/* Grid : une carte par broker */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-5">
              {brokerRows.map(r => {
                const pct = grandTotal > 0 ? (r.total_eur / grandTotal) * 100 : 0;
                return (
                  <div key={r.broker_id || "none"} className="bg-card border border-border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: r.broker_color }} />
                        <span className="text-bright text-[13px] font-semibold">{r.broker_name}</span>
                      </div>
                      <span className="text-dim text-[10px] font-mono">{pct.toFixed(1)}%</span>
                    </div>
                    <div className="text-[22px] font-bold font-mono text-bright tracking-tight mb-1">
                      {fmt(r.total_eur, 0)}€
                    </div>
                    <div className="text-[10px] text-muted font-mono mb-2">
                      {r.sub_account_count} sub-account{r.sub_account_count > 1 ? "s" : ""}
                      {" · "}Pos: {fmt(r.total_positions_eur, 0)}€
                      {" · "}Cash: {fmt(r.total_cash_eur, 0)}€
                    </div>
                    <div className="mt-2 h-1 bg-bg rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: r.broker_color }} />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Table détaillée : un row par sub_account */}
            <div className="bg-card border border-border rounded-lg overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border">
                <span className="text-[11px] font-semibold text-bright">Détail par sub-account</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-border">
                      {["Broker", "Compte", "Positions", "Cash (€)", "Valeur totale (€)"].map(h => (
                        <th key={h} className="text-left py-2 px-3 text-dim font-medium text-[9px] uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {brokerRows.flatMap(r => r.subAccounts.map(sa => {
                      const acc = accounts.find(a => a.id === sa.account_id);
                      const subHoldings = holdings.filter(h => h.sub_account_id === sa.id && Number(h.shares) > 0);
                      const posNative = subHoldings.reduce((s, h) => s + Number(h.shares) * Number(h.last_price || 0), 0);
                      const posEur = acc?.currency === "USD" ? posNative * fxUsdEur : posNative;
                      const totalEur = posEur + Number(sa.cash || 0);
                      return (
                        <tr key={sa.id} className="row-hover border-b border-border/10">
                          <td className="py-2 px-3">
                            <span className="inline-flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full" style={{ background: r.broker_color }} />
                              <span className="text-bright">{subAccLabel(sa)}</span>
                            </span>
                          </td>
                          <td className="py-2 px-3 font-mono text-[10px] text-muted">
                            {acc?.type} <span className="text-dim">({acc?.currency})</span>
                          </td>
                          <td className="py-2 px-3 font-mono text-[10px]">
                            {subHoldings.length > 0 ? (
                              <span className="text-muted">
                                {subHoldings.length} ticker{subHoldings.length > 1 ? "s" : ""}
                                <span className="text-dim"> · {subHoldings.map(h => h.ticker).join(", ")}</span>
                              </span>
                            ) : <span className="text-dim">—</span>}
                          </td>
                          <td className="py-2 px-3 font-mono text-muted">{fmt(sa.cash, 0)}€</td>
                          <td className="py-2 px-3 font-mono font-semibold text-bright">{fmt(totalEur, 0)}€</td>
                        </tr>
                      );
                    }))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="text-[10px] text-dim mt-3 font-mono text-center">
              Totaux en EUR (USD → EUR au taux spot {fmt(fxUsdEur, 4)})
            </div>
          </>
        )}
      </div>
    </div>
  );
}