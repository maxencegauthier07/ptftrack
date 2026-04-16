"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  XAxis, YAxis, Tooltip, ResponsiveContainer,
  Legend, Area, ComposedChart, Line,
} from "recharts";
import {
  Plus, TrendingUp, TrendingDown, DollarSign, Wallet, PiggyBank,
  X, Check, RefreshCw, Trash2, ArrowRightLeft, Zap,
  Loader2, Pencil,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import type {
  Account, Holding, DailySnapshot,
  CashMovement, RealizedPnl, Trade, FxRate, Broker, SubAccount,
} from "@/lib/types";
import SubAccountManager from "./SubAccountManager";

/* ─── Helpers ──────────────────────────────────── */
const fmt = (n: number | null | undefined, d = 2) =>
  n == null ? "—" : Number(n).toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtPct = (n: number) => (n >= 0 ? "+" : "") + fmt(n, 2) + "%";
const todayStr = () => new Date().toISOString().slice(0, 10);

const C = {
  accent: "#58a6ff", green: "#3fb950", red: "#f85149",
  border: "#1b2332", dim: "#484f58", muted: "#6e7681",
  bright: "#e6edf3", chartPtf: "#58a6ff", chartIdx: "#484f58",
};

/* ─── UI atoms ─────────────────────────────────── */
function Modal({ open, onClose, title, children }: any) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-card border border-border rounded-xl p-6 w-[92%] max-w-[460px] max-h-[85vh] overflow-auto">
        <div className="flex justify-between items-center mb-5">
          <h3 className="text-bright text-[15px] font-semibold">{title}</h3>
          <button onClick={onClose} className="text-muted hover:text-bright transition-colors"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Inp({ label, ...p }: any) {
  return (
    <div className="mb-3">
      {label && <label className="block text-muted text-[10px] mb-1 uppercase tracking-wider">{label}</label>}
      <input {...p} className="w-full py-[7px] px-[10px] bg-bg border border-border rounded-md text-bright text-[13px] outline-none font-mono placeholder:text-dim" />
    </div>
  );
}

function Sel({ label, options, ...p }: any) {
  return (
    <div className="mb-3">
      {label && <label className="block text-muted text-[10px] mb-1 uppercase tracking-wider">{label}</label>}
      <select {...p} className="w-full py-[7px] px-[10px] bg-bg border border-border rounded-md text-bright text-[13px] outline-none font-mono">
        {options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function Btn({ children, variant = "primary", small, disabled, className: cn, ...p }: any) {
  const v: Record<string, string> = {
    primary: "bg-accent text-white", ghost: "bg-transparent text-muted border border-border hover:text-bright hover:border-dim",
    danger: "bg-down text-white", green: "bg-up text-white",
  };
  return (
    <button {...p} disabled={disabled}
      className={`rounded-md cursor-pointer font-medium inline-flex items-center gap-1.5 transition-all
        ${small ? "py-[5px] px-[10px] text-[11px]" : "py-2 px-4 text-[13px]"}
        ${v[variant]} ${disabled ? "opacity-40 cursor-not-allowed" : ""} ${cn || ""}`}>
      {children}
    </button>
  );
}

function Stat({ label, value, sub, color, icon: I }: any) {
  return (
    <div className="bg-card border border-border rounded-lg py-3.5 px-4 flex-1 min-w-[148px]">
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-muted text-[9px] uppercase tracking-widest">{label}</span>
        {I && <I size={13} color={color || C.dim} />}
      </div>
      <div className="text-[19px] font-bold font-mono tracking-tight" style={{ color: color || C.bright }}>{value}</div>
      {sub && <div className="text-muted text-[10px] mt-0.5">{sub}</div>}
    </div>
  );
}

function Tabs({ items, active, onChange }: any) {
  return (
    <div className="flex gap-0.5 bg-bg rounded-md p-0.5">
      {items.map((t: any) => (
        <button key={t.key} onClick={() => onChange(t.key)}
          className={`py-[5px] px-3 rounded text-[11px] font-medium transition-all border
            ${active === t.key ? "bg-card text-bright border-border" : "bg-transparent text-dim border-transparent hover:text-muted"}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

function CTooltip({ active, payload, label, currency }: any) {
  if (!active || !payload?.length) return null;
  const ptf = payload.find((p: any) => p.dataKey === "ptf");
  const idx = payload.find((p: any) => p.dataKey === "idx");
  return (
    <div className="bg-card border border-border rounded-md py-2.5 px-3.5 text-[11px] font-mono">
      <div className="text-muted mb-1.5">{label}</div>
      {ptf && <div style={{ color: C.chartPtf }} className="mb-0.5">PTF {fmt(ptf.value)} {currency}</div>}
      {idx && <div className="text-muted">IDX {fmt(idx.value)} {currency}</div>}
      {ptf && idx && idx.value > 0 && (
        <div className="mt-1 pt-1 border-t border-border" style={{ color: ptf.value > idx.value ? C.green : C.red }}>
          α {fmtPct(((ptf.value / idx.value) - 1) * 100)}
        </div>
      )}
    </div>
  );
}

/* ═══ MAIN ═════════════════════════════════════════ */
export default function StocksDashboard({ personId }: { personId: string }) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [updateLog, setUpdateLog] = useState<any[] | null>(null);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [subAccounts, setSubAccounts] = useState<SubAccount[]>([]);
  const [brokers, setBrokers] = useState<Broker[]>([]);
  const [snaps, setSnaps] = useState<DailySnapshot[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [cashMov, setCashMov] = useState<CashMovement[]>([]);
  const [pnls, setPnls] = useState<RealizedPnl[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [fxRates, setFxRates] = useState<FxRate[]>([]);

  const [accType, setAccType] = useState("ALL");
  const [modal, setModal] = useState<string | null>(null);
  const [form, setForm] = useState<any>({});
  const [tab, setTab] = useState("chart");
  const [updateDate, setUpdateDate] = useState(todayStr());
  const [showSubAccMgr, setShowSubAccMgr] = useState(true);

  const notify = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2500); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [aR, bR, sR, hR, cR, rR, tR, fxR] = await Promise.all([
        supabase.from("accounts").select("*, people(name)").eq("person_id", personId).order("type"),
        supabase.from("brokers").select("*").order("name"),
        supabase.from("daily_snapshots").select("*").order("date", { ascending: true }).limit(9999),
        supabase.from("holdings").select("*").order("ticker"),
        supabase.from("cash_movements").select("*").order("date", { ascending: false }).limit(200),
        supabase.from("realized_pnl").select("*").order("date", { ascending: false }).limit(200),
        supabase.from("trades").select("*").order("date", { ascending: false }).limit(500),
        supabase.from("fx_rates").select("*").order("date", { ascending: false }).limit(100),
      ]);
      if (aR.error) throw aR.error;
      const accs = (aR.data || []) as Account[];
      setAccounts(accs);
      setBrokers((bR.data || []) as Broker[]);

      // sub_accounts pour ces comptes uniquement
      const accIds = accs.map(a => a.id);
      if (accIds.length) {
        const { data: saData } = await supabase.from("sub_accounts")
          .select("*, brokers(name, color)")
          .in("account_id", accIds)
          .order("created_at");
        setSubAccounts((saData || []) as SubAccount[]);
      } else {
        setSubAccounts([]);
      }

      setSnaps((sR.data || []) as DailySnapshot[]);
      setHoldings((hR.data || []) as Holding[]);
      setCashMov((cR.data || []) as CashMovement[]);
      setPnls((rR.data || []) as RealizedPnl[]);
      setTrades((tR.data || []) as Trade[]);
      setFxRates((fxR.data || []) as FxRate[]);
      setErr(null);
    } catch (e: any) { setErr(e.message || String(e)); }
    setLoading(false);
  }, [personId]);

  useEffect(() => { load(); }, [load]);

  const runUpdate = async (targetDate?: string) => {
    setUpdating(true); setErr(null); setUpdateLog(null);
    const d = targetDate || updateDate;
    try {
      const res = await fetch(`/api/update?force=true&date=${d}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Update failed");
      setUpdateLog(data.logs);
      notify(`✓ ${data.updated} snapshot(s) — ${data.date}`);
      await load();
    } catch (e: any) { setErr(e.message); }
    setUpdating(false);
  };

  /* ─── Derived ────────────────────────────────── */
  const pAccs = accounts;
  const fAccs = useMemo(() => accType === "ALL" ? pAccs : pAccs.filter(a => a.type === accType), [pAccs, accType]);
  const accIds = useMemo(() => new Set(fAccs.map(a => a.id)), [fAccs]);

  // Sub_accounts des comptes filtrés
  const fSubAccs = useMemo(() => subAccounts.filter(sa => accIds.has(sa.account_id)), [subAccounts, accIds]);

  // Helper : label d'un sub_account
  const subAccLabel = (sa: SubAccount | undefined): string => {
    if (!sa) return "?";
    const b = sa.brokers?.name || "Non assigné";
    return sa.name ? `${b} · ${sa.name}` : b;
  };

  const chartData = useMemo(() => {
    const m: Record<string, { date: string; ptf: number; idx: number }> = {};
    snaps.forEach(s => {
      if (!accIds.has(s.account_id)) return;
      const a = accounts.find(x => x.id === s.account_id);
      if (!m[s.date]) m[s.date] = { date: s.date, ptf: 0, idx: 0 };
      const fx = a?.currency === "USD" && accType === "ALL" ? (s.fx_rate || 0.87) : 1;
      m[s.date].ptf += Number(s.portfolio_value) * fx;
      m[s.date].idx += Number(s.index_value) * fx;
    });
    return Object.values(m).sort((a, b) => a.date.localeCompare(b.date));
  }, [snaps, accIds, accounts, accType]);

  const last = chartData[chartData.length - 1];
  const curVal = last?.ptf || 0;

  const latestFxMap = useMemo(() => {
    const map: Record<string, number> = { EUR: 1 };
    const byPair: Record<string, FxRate> = {};
    for (const r of fxRates) {
      if (!byPair[r.pair] || r.date > byPair[r.pair].date) byPair[r.pair] = r;
    }
    if (byPair["USDEUR"]) map["USD"] = Number(byPair["USDEUR"].rate);
    if (byPair["CADEUR"]) map["CAD"] = Number(byPair["CADEUR"].rate);
    if (byPair["AUDEUR"]) map["AUD"] = Number(byPair["AUDEUR"].rate);
    return map;
  }, [fxRates]);

  const latestFx = latestFxMap["USD"] || (() => {
    const allFx = snaps.filter(s => s.fx_rate && s.fx_rate > 0).sort((a, b) => b.date.localeCompare(a.date));
    return allFx[0]?.fx_rate || 0.87;
  })();

  const totalInvEur = fAccs.reduce((s, a) => s + Number(a.total_invested || 0), 0);
  const totalInvDisplay = accType === "CTO" ? totalInvEur / latestFx : totalInvEur;
  const totalPnl = curVal - totalInvDisplay;

  // ★ Cash = somme des sub_accounts des comptes filtrés
  const lastCash = useMemo(() => {
    return fSubAccs.reduce((s, sa) => s + Number(sa.cash || 0), 0);
  }, [fSubAccs]);

  const cur = accType === "CTO" ? "$" : "€";
  const invSub = accType === "CTO"
    ? `${fmt(totalInvEur, 0)}€ au taux ${fmt(latestFx, 4)}`
    : "";

  const periodPerfs = useMemo(() => {
    if (chartData.length < 2) return null;
    const lastPtf = chartData[chartData.length - 1].ptf;
    const lastIdx = chartData[chartData.length - 1].idx;
    const lastDate = chartData[chartData.length - 1].date;

    const findSnap = (daysAgo: number) => {
      const target = new Date(lastDate);
      target.setDate(target.getDate() - daysAgo);
      const tStr = target.toISOString().slice(0, 10);
      for (let i = chartData.length - 1; i >= 0; i--) {
        if (chartData[i].date <= tStr) return chartData[i];
      }
      return chartData[0];
    };

    const findYtd = () => {
      const janFirst = `${lastDate.slice(0, 4)}-01-01`;
      for (const s of chartData) {
        if (s.date >= janFirst) return s;
      }
      return chartData[0];
    };

    const depositsBetween = (fromDate: string, toDate: string) => {
      const eur = cashMov
        .filter(c => accIds.has(c.account_id) && c.date > fromDate && c.date <= toDate)
        .reduce((s, c) => s + Number(c.amount), 0);
      if (accType === "CTO" && latestFx > 0) return eur / latestFx;
      return eur;
    };

    const calc = (ref: { ptf: number; idx: number; date: string } | undefined) => {
      if (!ref || ref.ptf === 0 || ref.idx === 0) return null;
      const deposits = depositsBetween(ref.date, lastDate);
      const netPnl = (lastPtf - ref.ptf) - deposits;
      const netPct = (netPnl / ref.ptf) * 100;
      const idxNetPnl = (lastIdx - ref.idx) - deposits;
      const idxNetPct = (idxNetPnl / ref.idx) * 100;
      const idxPnl = ref.ptf * (idxNetPct / 100);
      return {
        netPct, netPnl, idxPct: idxNetPct, idxPnl,
        rawPnl: lastPtf - ref.ptf, rawIdxPnl: lastIdx - ref.idx,
        refPtf: ref.ptf, refIdx: ref.idx,
      };
    };

    const prev = chartData.length >= 2 ? chartData[chartData.length - 2] : null;
    const startDate = chartData[0]?.date || "";
    const startLabel = startDate ? `Dep. ${startDate.slice(5).replace("-", "/")}` : "Total";
    return {
      "1J": calc(prev!),
      "1M": calc(findSnap(30)),
      YTD: calc(findYtd()),
      [startLabel]: calc(chartData[0]),
    };
  }, [chartData, cashMov, accIds, accType, latestFx]);

  // Holdings filtrés — on filtre par sub_account_id appartenant aux comptes filtrés
  const fSubAccIds = useMemo(() => new Set(fSubAccs.map(sa => sa.id)), [fSubAccs]);
  const fH = useMemo(() => holdings.filter(h => fSubAccIds.has(h.sub_account_id) && Number(h.shares) > 0), [holdings, fSubAccIds]);
  const closedH = useMemo(() => holdings.filter(h => fSubAccIds.has(h.sub_account_id) && Number(h.shares) === 0), [holdings, fSubAccIds]);
  const fC = useMemo(() => cashMov.filter(c => accIds.has(c.account_id)), [cashMov, accIds]);
  const fP = useMemo(() => pnls.filter(r => accIds.has(r.account_id)), [pnls, accIds]);
  const fT = useMemo(() => trades.filter(t => accIds.has(t.account_id)), [trades, accIds]);
  const hVal = useMemo(() => fH.reduce((s, h) => s + Number(h.shares) * Number(h.last_price || 0), 0), [fH]);

  // Options de sub_accounts pour les dropdowns (ne montre que ceux des comptes filtrés)
  const subAccOptions = useMemo(() => fSubAccs.map(sa => {
    const acc = accounts.find(a => a.id === sa.account_id);
    return { value: sa.id, label: `${acc?.type} · ${subAccLabel(sa)}` };
  }), [fSubAccs, accounts]);

  // Tous les sub_accounts de la personne (pour les dropdowns quand on veut tout voir)
  const allSubAccOptions = useMemo(() => subAccounts.map(sa => {
    const acc = accounts.find(a => a.id === sa.account_id);
    return { value: sa.id, label: `${acc?.type} · ${subAccLabel(sa)}` };
  }), [subAccounts, accounts]);

  /* ─── Actions ────────────────────────────────── */
  const recalc = async (date: string) => {
    await fetch(`/api/update?force=true&date=${date}`);
  };

  // Récupère l'account_id à partir d'un sub_account_id
  const subAccToAccId = (saId: string): string | null => {
    const sa = subAccounts.find(x => x.id === saId);
    return sa?.account_id || null;
  };

  // ── DÉPÔT / RETRAIT ── (sur un sub_account spécifique)
  const addCash = async () => {
    try {
      const amt = Number(form.amount);
      const subAccId = form.sub_account_id;
      const accId = subAccToAccId(subAccId);
      if (!accId) { setErr("Sub-account introuvable"); return; }

      const { data: freshSub } = await supabase
        .from("sub_accounts").select("cash").eq("id", subAccId).single();
      const { data: freshAcc } = await supabase
        .from("accounts").select("cash, total_invested").eq("id", accId).single();

      await supabase.from("cash_movements").insert({
        account_id: accId,
        sub_account_id: subAccId,
        date: form.date, amount: amt,
        description: form.description || (amt > 0 ? "Dépôt" : "Retrait"),
      });

      await supabase.from("sub_accounts").update({
        cash: Number(freshSub?.cash || 0) + amt,
        updated_at: new Date().toISOString(),
      }).eq("id", subAccId);

      await supabase.from("accounts").update({
        total_invested: Number(freshAcc?.total_invested || 0) + amt,
        cash: Number(freshAcc?.cash || 0) + amt,
      }).eq("id", accId);

      notify("✓ Cash — recalcul..."); setModal(null);
      await recalc(form.date); load();
    } catch (e: any) { setErr(e.message); }
  };

  // ── +/- VALUE / DIVIDENDE ── (sur un sub_account)
  const addPnl = async () => {
    try {
      const subAccId = form.sub_account_id;
      const accId = subAccToAccId(subAccId);
      if (!accId) { setErr("Sub-account introuvable"); return; }

      const { data: freshSub } = await supabase
        .from("sub_accounts").select("cash").eq("id", subAccId).single();
      const { data: freshAcc } = await supabase
        .from("accounts").select("cash").eq("id", accId).single();

      if (form.isDividend) {
        // ═══ Mode dividende ═══
        const tradeCcy = form.dividendCcy || "EUR";
        const nativeAmount = Number(form.amountNative || form.amount || 0);
        let amountEur = nativeAmount;
        let fxUsed: number | null = null;
        if (tradeCcy !== "EUR") {
          fxUsed = Number(form.dividendFx) || latestFxMap[tradeCcy] || 1;
          amountEur = nativeAmount * fxUsed;
        }
        if (amountEur <= 0) { setErr("Montant invalide"); return; }

        // 1. Enregistre dans la table dividends (dédiée aux stats)
        await supabase.from("dividends").insert({
          account_id: accId,
          sub_account_id: subAccId,
          date: form.date,
          ticker: form.ticker?.toUpperCase() || null,
          amount: Math.round(amountEur * 100) / 100,
          amount_native: tradeCcy !== "EUR" ? nativeAmount : null,
          currency_native: tradeCcy !== "EUR" ? tradeCcy : null,
          fx_rate: fxUsed,
          withholding_tax: Number(form.withholdingTax || 0),
          notes: form.description || null,
        });

        // 2. Met à jour le cash (crédité)
        await supabase.from("sub_accounts").update({
          cash: Math.round((Number(freshSub?.cash || 0) + amountEur) * 100) / 100,
        }).eq("id", subAccId);
        await supabase.from("accounts").update({
          cash: Math.round((Number(freshAcc?.cash || 0) + amountEur) * 100) / 100,
        }).eq("id", accId);

        notify(`✓ Dividende ${fmt(amountEur, 2)}€ — recalcul...`);
      } else {
        // ═══ Mode P&L / frais classique ═══
        const amt = Number(form.amount);
        if (!amt) { setErr("Montant invalide"); return; }

        await supabase.from("realized_pnl").insert({
          account_id: accId, sub_account_id: subAccId,
          date: form.date, amount: amt,
          ticker: form.ticker || null, description: form.description || null,
        });
        await supabase.from("sub_accounts").update({
          cash: Number(freshSub?.cash || 0) + amt,
        }).eq("id", subAccId);
        await supabase.from("accounts").update({
          cash: Number(freshAcc?.cash || 0) + amt,
        }).eq("id", accId);

        notify("✓ P&L — recalcul...");
      }

      setModal(null);
      await recalc(form.date); load();
    } catch (e: any) { setErr(e.message); }
  };

  // ── POSITION MANUELLE ──
  const addHolding = async () => {
    try {
      const subAccId = form.sub_account_id;
      const accId = subAccToAccId(subAccId);
      if (!accId) { setErr("Sub-account introuvable"); return; }

      // Check si déjà existant sur ce sub_account
      const { data: existing } = await supabase.from("holdings")
        .select("*").eq("sub_account_id", subAccId).eq("ticker", form.ticker.toUpperCase()).maybeSingle();

      if (existing) {
        await supabase.from("holdings").update({
          shares: Number(form.shares),
          avg_cost: Number(form.avg_cost || 0),
          last_price: Number(form.last_price || 0),
          label: form.label || null,
        }).eq("id", existing.id);
      } else {
        await supabase.from("holdings").insert({
          account_id: accId,
          sub_account_id: subAccId,
          ticker: form.ticker.toUpperCase(),
          label: form.label || null, shares: Number(form.shares),
          avg_cost: Number(form.avg_cost || 0), last_price: Number(form.last_price || 0),
        });
      }
      notify("✓ Position"); setModal(null); load();
    } catch (e: any) { setErr(e.message); }
  };

  // ── TRADE ── (sur un sub_account spécifique)
  const addTrade = async () => {
    try {
      const tradePrice = Number(form.price);
      const tradeShares = Number(form.shares);
      const tradeFees = Number(form.fees || 0);
      const tradeCcy = form.tradeCcy || "EUR";
      const subAccId = form.sub_account_id;
      const accId = subAccToAccId(subAccId);
      if (!accId) { setErr("Sub-account introuvable"); return; }

      let toEur = 1;
      if (tradeCcy !== "EUR") {
        toEur = Number(form.tradeFx) || latestFxMap[tradeCcy] || 0;
        if (toEur <= 0) toEur = 1;
      }
      const priceEur = tradePrice * toEur;
      const feesEur = tradeFees * toEur;
      const totalCostEur = priceEur * tradeShares + feesEur;

      const ex = holdings.find(h => h.sub_account_id === subAccId && h.ticker === form.ticker.toUpperCase());
      if (form.side === "SELL") {
        const currentShares = ex ? Number(ex.shares) : 0;
        if (tradeShares > currentShares + 0.0001) {
          setErr(`Vente impossible: ${tradeShares} > position actuelle ${currentShares} ${form.ticker.toUpperCase()} sur ce sub-account`);
          return;
        }
      }

      // 1. Trade
      await supabase.from("trades").insert({
        account_id: accId, sub_account_id: subAccId,
        date: form.date, ticker: form.ticker.toUpperCase(),
        side: form.side, shares: tradeShares, price: tradePrice,
        fees: tradeFees, notes: form.notes ? `[${tradeCcy}] ${form.notes}` : `[${tradeCcy}]`,
      });

      // 2. Holding
      const delta = form.side === "BUY" ? tradeShares : -tradeShares;
      if (ex) {
        const newShares = Number(ex.shares) + delta;
        let newAvg = Number(ex.avg_cost);
        if (form.side === "BUY" && Number(ex.shares) > 0) {
          newAvg = (Number(ex.avg_cost) * Number(ex.shares) + priceEur * tradeShares) / (Number(ex.shares) + tradeShares);
        } else if (form.side === "BUY") {
          newAvg = priceEur;
        }
        await supabase.from("holdings").update({
          shares: Math.max(0, newShares),
          avg_cost: Math.round(newAvg * 100) / 100,
        }).eq("id", ex.id);
      } else if (form.side === "BUY") {
        await supabase.from("holdings").insert({
          account_id: accId, sub_account_id: subAccId,
          ticker: form.ticker.toUpperCase(),
          shares: tradeShares, avg_cost: Math.round(priceEur * 100) / 100,
        });
      }

      // 3. Cash du sub_account + account
      const { data: freshSub } = await supabase
        .from("sub_accounts").select("cash").eq("id", subAccId).single();
      const { data: freshAcc } = await supabase
        .from("accounts").select("cash").eq("id", accId).single();
      const cashDelta = form.side === "BUY" ? -totalCostEur : (priceEur * tradeShares - feesEur);

      await supabase.from("sub_accounts").update({
        cash: Math.round((Number(freshSub?.cash || 0) + cashDelta) * 100) / 100,
      }).eq("id", subAccId);
      await supabase.from("accounts").update({
        cash: Math.round((Number(freshAcc?.cash || 0) + cashDelta) * 100) / 100,
      }).eq("id", accId);

      notify(`✓ ${form.side} ${form.ticker.toUpperCase()} — recalcul...`);
      setModal(null);
      await recalc(form.date); load();
    } catch (e: any) { setErr(e.message); }
  };

  // ── SUPPRESSIONS (reverse des effets) ──
  const delCashMovement = async (item: CashMovement) => {
    const amt = Number(item.amount);
    if (item.sub_account_id) {
      const { data: sub } = await supabase.from("sub_accounts").select("cash").eq("id", item.sub_account_id).single();
      await supabase.from("sub_accounts").update({
        cash: Number(sub?.cash || 0) - amt,
      }).eq("id", item.sub_account_id);
    }
    const { data: fresh } = await supabase
      .from("accounts").select("cash, total_invested").eq("id", item.account_id).single();
    await supabase.from("accounts").update({
      cash: Number(fresh?.cash || 0) - amt,
      total_invested: Number(fresh?.total_invested || 0) - amt,
    }).eq("id", item.account_id);
    await supabase.from("cash_movements").delete().eq("id", item.id);
    notify("✓ Mouvement annulé — recalcul...");
    await recalc(item.date); load();
  };

  const delRealizedPnl = async (item: RealizedPnl) => {
    const amt = Number(item.amount);
    if (item.sub_account_id) {
      const { data: sub } = await supabase.from("sub_accounts").select("cash").eq("id", item.sub_account_id).single();
      await supabase.from("sub_accounts").update({
        cash: Number(sub?.cash || 0) - amt,
      }).eq("id", item.sub_account_id);
    }
    const { data: fresh } = await supabase
      .from("accounts").select("cash").eq("id", item.account_id).single();
    await supabase.from("accounts").update({
      cash: Number(fresh?.cash || 0) - amt,
    }).eq("id", item.account_id);
    await supabase.from("realized_pnl").delete().eq("id", item.id);
    notify("✓ P&L annulé — recalcul...");
    await recalc(item.date); load();
  };

  const delTrade = async (item: Trade) => {
    const ex = holdings.find(h => h.sub_account_id === item.sub_account_id && h.ticker === item.ticker);
    if (ex) {
      const reverseDelta = item.side === "BUY" ? -Number(item.shares) : Number(item.shares);
      await supabase.from("holdings").update({
        shares: Math.max(0, Number(ex.shares) + reverseDelta),
      }).eq("id", ex.id);
    }
    const acc = accounts.find(a => a.id === item.account_id);
    const fxGuess = acc?.currency === "USD" ? latestFx : 1;
    const costEur = Number(item.price) * Number(item.shares) * fxGuess;
    const cashReverse = item.side === "BUY" ? costEur : -costEur;

    if (item.sub_account_id) {
      const { data: sub } = await supabase.from("sub_accounts").select("cash").eq("id", item.sub_account_id).single();
      await supabase.from("sub_accounts").update({
        cash: Math.round((Number(sub?.cash || 0) + cashReverse) * 100) / 100,
      }).eq("id", item.sub_account_id);
    }
    const { data: fresh } = await supabase
      .from("accounts").select("cash").eq("id", item.account_id).single();
    await supabase.from("accounts").update({
      cash: Math.round((Number(fresh?.cash || 0) + cashReverse) * 100) / 100,
    }).eq("id", item.account_id);

    await supabase.from("trades").delete().eq("id", item.id);
    notify("✓ Trade annulé — recalcul...");
    await recalc(item.date); load();
  };

  const delItem = async (table: string, id: string) => {
    await supabase.from(table).delete().eq("id", id); load();
  };

  const editHolding = async () => {
    try {
      await supabase.from("holdings").update({
        shares: Number(form.shares),
        avg_cost: Number(form.avg_cost),
        label: form.label || null,
      }).eq("id", form.id);
      notify("✓ Position modifiée"); setModal(null); load();
    } catch (e: any) { setErr(e.message); }
  };

  if (loading && accounts.length === 0) {
    return <div className="flex items-center justify-center py-20"><span className="font-mono text-dim text-sm">loading...</span></div>;
  }

  /* ═══ RENDER ═════════════════════════════════════ */
  return (
    <div>
      {toast && <div className="fixed top-3 right-3 z-50 bg-up text-white py-2 px-4 rounded-md text-xs font-mono animate-fade-up shadow-lg shadow-black/40">{toast}</div>}

      <div className="border-b border-border py-2 px-5 flex items-center justify-between flex-wrap gap-2">
        <span className="text-[10px] text-dim uppercase tracking-widest">Stocks</span>
        <div className="flex items-center gap-2">
          <Tabs items={[{ key: "ALL", label: "Tout (€)" }, { key: "PEA", label: "PEA €" }, { key: "CTO", label: "CTO $" }]} active={accType} onChange={setAccType} />
          <button onClick={load} className="text-dim hover:text-muted transition-colors p-1"><RefreshCw size={12} /></button>
        </div>
      </div>

      <div className="p-4 md:p-5 max-w-[1280px] mx-auto">
        {err && (
          <div className="bg-down-bg border border-down/30 rounded-md py-2 px-3.5 mb-3.5 text-down text-[11px] font-mono flex justify-between items-start">
            <span className="break-all">{err}</span>
            <button onClick={() => setErr(null)} className="ml-3 shrink-0">×</button>
          </div>
        )}

        {/* STATS */}
        {(() => {
          const sinceStart = periodPerfs ? Object.values(periodPerfs).pop() : null;
          const pnl = sinceStart?.netPnl ?? totalPnl;
          const pnlPct = sinceStart?.netPct ?? (totalInvDisplay > 0 ? (totalPnl / totalInvDisplay) * 100 : 0);

          let fxGain: number | null = null;
          if (accType === "ALL" && sinceStart) {
            let pnlAtSpot = 0;
            for (const acc of fAccs) {
              const accSnaps = snaps.filter(s => s.account_id === acc.id);
              if (accSnaps.length < 2) continue;
              const sorted = [...accSnaps].sort((a, b) => a.date.localeCompare(b.date));
              const firstS = sorted[0];
              const lastS = sorted[sorted.length - 1];
              const deps = cashMov
                .filter(c => c.account_id === acc.id && c.date > firstS.date && c.date <= lastS.date)
                .reduce((s, c) => s + Number(c.amount), 0);
              const raw = Number(lastS.portfolio_value) - Number(firstS.portfolio_value);
              if (acc.currency === "USD") {
                const depsUsd = latestFx > 0 ? deps / latestFx : 0;
                pnlAtSpot += (raw - depsUsd) * latestFx;
              } else {
                pnlAtSpot += raw - deps;
              }
            }
            fxGain = pnl - pnlAtSpot;
          }

          return (
            <div className="flex gap-2.5 mb-4 flex-wrap">
              <Stat label="Valeur" value={`${fmt(curVal, 0)}${cur}`} icon={Wallet}
                sub={`Investi: ${fmt(totalInvDisplay, 0)}${cur}${invSub ? ` (${invSub})` : ""}`} />
              <Stat label="P&L" value={`${pnl >= 0 ? "+" : ""}${fmt(pnl, 0)}${cur}`}
                color={pnl >= 0 ? C.green : C.red} icon={pnl >= 0 ? TrendingUp : TrendingDown}
                sub={`${fmtPct(pnlPct)}${fxGain != null && Math.abs(fxGain) > 1 ? ` · dont FX: ${fxGain >= 0 ? "+" : ""}${fmt(fxGain, 0)}€` : ""}`} />
              <Stat label="Cash" value={`${fmt(lastCash, 0)}€`} icon={PiggyBank} color={C.accent} />
            </div>
          );
        })()}

        {/* PERIOD PANELS — inchangé */}
        {periodPerfs && (() => {
          const labels = Object.keys(periodPerfs);
          const vals = Object.values(periodPerfs);
          const S = (n: number, d = 0) => `${n >= 0 ? "+" : ""}${fmt(n, d)}`;

          return (
            <div className="flex gap-3 mb-4 flex-col lg:flex-row">
              <div className="bg-card border border-border rounded-lg flex-1 min-w-[280px] overflow-x-auto">
                <div className="px-3 py-2.5 border-b border-border">
                  <span className="text-[11px] font-semibold text-bright">📈 Performance</span>
                </div>
                <table className="w-full text-center" style={{ borderCollapse: "collapse" }}>
                  <thead>
                    <tr className="border-b border-border/40">
                      <th className="py-2 px-3 text-left w-[70px]"></th>
                      {labels.map(l => <th key={l} className="py-2 px-2 text-[10px] text-muted uppercase tracking-wider">{l}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-border/15">
                      <td className="py-2.5 px-3 text-[10px] text-muted text-left font-semibold">Perf</td>
                      {vals.map((p, i) => <td key={i} className="py-2.5 px-2 font-mono">
                        {p ? <span className="text-[14px] font-bold" style={{ color: p.netPct >= 0 ? C.green : C.red }}>{fmtPct(p.netPct)}</span> : <span className="text-dim">—</span>}
                      </td>)}
                    </tr>
                    <tr className="border-b border-border/15">
                      <td className="py-2 px-3 text-[10px] text-muted text-left">P&L</td>
                      {vals.map((p, i) => <td key={i} className="py-2 px-2 font-mono">
                        {p ? <span className="text-[12px] font-semibold" style={{ color: p.netPnl >= 0 ? C.green : C.red }}>{S(p.netPnl)}{cur}</span> : <span className="text-dim">—</span>}
                      </td>)}
                    </tr>
                    <tr className="border-b border-border/8 bg-bg/30">
                      <td className="py-2 px-3 text-[9px] text-dim text-left">Indice %</td>
                      {vals.map((p, i) => <td key={i} className="py-2 px-2 font-mono text-[11px] text-muted">
                        {p ? fmtPct(p.idxPct) : "—"}
                      </td>)}
                    </tr>
                    <tr className="bg-bg/30">
                      <td className="py-2 px-3 text-[9px] text-dim text-left">P&L idx</td>
                      {vals.map((p, i) => <td key={i} className="py-2 px-2 font-mono text-[11px] text-muted">
                        {p ? <>{S(p.idxPnl)}{cur}</> : "—"}
                      </td>)}
                    </tr>
                    <tr className="border-t border-border/30">
                      <td className="py-2.5 px-3 text-[10px] text-muted text-left font-semibold">Alpha</td>
                      {vals.map((p, i) => {
                        const a = p ? p.netPct - p.idxPct : null;
                        return <td key={i} className="py-2.5 px-2 font-mono">
                          {a != null ? <span className="text-[12px] font-bold" style={{ color: a >= 0 ? C.green : C.red }}>{fmtPct(a)}</span> : <span className="text-dim">—</span>}
                        </td>;
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="bg-card border border-border rounded-lg flex-1 min-w-[280px] overflow-x-auto">
                <div className="px-3 py-2.5 border-b border-border">
                  <span className="text-[11px] font-semibold text-bright">💰 Valorisation</span>
                </div>
                <table className="w-full text-center" style={{ borderCollapse: "collapse" }}>
                  <thead>
                    <tr className="border-b border-border/40">
                      <th className="py-2 px-3 text-left w-[70px]"></th>
                      {labels.map(l => <th key={l} className="py-2 px-2 text-[10px] text-muted uppercase tracking-wider">{l}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-border/15">
                      <td className="py-2 px-3 text-[10px] text-muted text-left">Début</td>
                      {vals.map((p, i) => <td key={i} className="py-2 px-2 font-mono text-[11px] text-muted">
                        {p ? <>{fmt(p.refPtf, 0)}{cur}</> : "—"}
                      </td>)}
                    </tr>
                    <tr className="border-b border-border/15">
                      <td className="py-2.5 px-3 text-[10px] text-muted text-left font-semibold">Δ ptf</td>
                      {vals.map((p, i) => <td key={i} className="py-2.5 px-2 font-mono">
                        {p ? <span className="text-[13px] font-bold" style={{ color: p.rawPnl >= 0 ? C.green : C.red }}>{S(p.rawPnl)}{cur}</span> : <span className="text-dim">—</span>}
                      </td>)}
                    </tr>
                    <tr className="border-b border-border/8 bg-bg/30">
                      <td className="py-2 px-3 text-[9px] text-dim text-left">Début idx</td>
                      {vals.map((p, i) => <td key={i} className="py-2 px-2 font-mono text-[11px] text-muted">
                        {p ? <>{fmt(p.refIdx, 0)}{cur}</> : "—"}
                      </td>)}
                    </tr>
                    <tr className="bg-bg/30">
                      <td className="py-2 px-3 text-[9px] text-dim text-left">Δ idx</td>
                      {vals.map((p, i) => <td key={i} className="py-2 px-2 font-mono text-[11px] text-muted">
                        {p ? <>{S(p.rawIdxPnl)}{cur}</> : "—"}
                      </td>)}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}

        {/* ACTIONS */}
        <div className="flex gap-1.5 mb-4 flex-wrap items-center">
          <div className="flex items-center gap-1 bg-up/10 border border-up/30 rounded-md px-1">
            <input type="date" value={updateDate} onChange={e => setUpdateDate(e.target.value)}
              className="bg-transparent text-bright text-[11px] font-mono py-[5px] px-1 outline-none border-none" />
            <Btn small variant="green" onClick={() => runUpdate()} disabled={updating}>
              {updating ? <Loader2 size={11} className="animate-spin" /> : <Zap size={11} />}
              {updating ? "..." : "Run"}
            </Btn>
          </div>
          <Btn small variant="ghost" onClick={() => { setForm({ sub_account_id: fSubAccs[0]?.id, date: todayStr(), amount: "", description: "" }); setModal("cash"); }}>
            <DollarSign size={11} /> Dépôt/Retrait
          </Btn>
          <Btn small variant="ghost" onClick={() => { setForm({ sub_account_id: fSubAccs[0]?.id, date: todayStr(), ticker: "", side: "BUY", shares: "", price: "", fees: "", notes: "", tradeCcy: accType === "PEA" ? "EUR" : "USD", tradeFx: "" }); setModal("trade"); }}>
            <ArrowRightLeft size={11} /> Trade
          </Btn>
          <Btn small variant="ghost" onClick={() => { setForm({ sub_account_id: fSubAccs[0]?.id, date: todayStr(), amount: "", amountNative: "", ticker: "", description: "", isDividend: false, dividendCcy: "EUR", dividendFx: "", withholdingTax: "" }); setModal("pnl"); }}>
            <TrendingUp size={11} /> +/- Value
          </Btn>
          <Btn small variant="ghost" onClick={() => { setForm({ sub_account_id: fSubAccs[0]?.id, ticker: "", label: "", shares: "", avg_cost: "", last_price: "" }); setModal("holding"); }}>
            <Plus size={11} /> Position
          </Btn>
          {updateLog && (
            <Btn small variant="ghost" onClick={() => setModal("logs")}>
              📋 Logs
            </Btn>
          )}
        </div>

        {/* ★ SUB-ACCOUNT MANAGERS */}
        <div className="mb-4">
          <button onClick={() => setShowSubAccMgr(!showSubAccMgr)}
            className="text-[10px] text-dim uppercase tracking-widest mb-2 hover:text-muted inline-flex items-center gap-1">
            Gestion brokers {showSubAccMgr ? "▾" : "▸"}
          </button>
          {showSubAccMgr && fAccs.map(acc => (
            <SubAccountManager
              key={acc.id}
              account={acc}
              subAccounts={subAccounts.filter(sa => sa.account_id === acc.id)}
              brokers={brokers}
              holdings={holdings.filter(h => subAccounts.some(sa => sa.id === h.sub_account_id && sa.account_id === acc.id))}
              latestFx={latestFx}
              onChange={load}
              onNotify={notify}
              onError={setErr}
            />
          ))}
        </div>

        {/* TABS */}
        <div className="mb-3.5">
          <Tabs items={[
            { key: "chart", label: "📈 Performance" },
            { key: "holdings", label: `💼 Positions (${fH.length})` },
            { key: "activity", label: "💰 Activité" },
            { key: "trades", label: `🔄 Trades (${fT.length})` },
            { key: "snaps", label: "📊 Clôtures" },
          ]} active={tab} onChange={setTab} />
        </div>

        {/* CHART */}
        {tab === "chart" && (
          <div className="bg-card border border-border rounded-lg p-4">
            <div className="flex justify-between items-center mb-3.5 px-1.5">
              <span className="text-xs font-semibold text-bright">Portefeuille vs Indice</span>
              <span className="text-dim text-[10px] font-mono">
                {chartData.length > 0 && `${chartData[0].date} → ${chartData[chartData.length - 1].date} · ${chartData.length}j`}
              </span>
            </div>
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={320}>
                <ComposedChart data={chartData} margin={{ top: 5, right: 8, left: 8, bottom: 5 }}>
                  <defs>
                    <linearGradient id="gP" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.chartPtf} stopOpacity={0.12} />
                      <stop offset="100%" stopColor={C.chartPtf} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: C.dim }} tickFormatter={d => d.slice(5)} axisLine={{ stroke: C.border }} tickLine={false} />
                  <YAxis tick={{ fontSize: 9, fill: C.dim }} axisLine={false} tickLine={false} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} domain={["auto", "auto"]} />
                  <Tooltip content={<CTooltip currency={cur} />} />
                  <Area type="monotone" dataKey="ptf" fill="url(#gP)" stroke="none" />
                  <Line type="monotone" dataKey="ptf" stroke={C.chartPtf} strokeWidth={2} dot={false} name="Portefeuille" />
                  <Line type="monotone" dataKey="idx" stroke={C.chartIdx} strokeWidth={1.5} dot={false} name="Indice" strokeDasharray="3 2" />
                  <Legend wrapperStyle={{ fontSize: 10, paddingTop: 8 }} />
                </ComposedChart>
              </ResponsiveContainer>
            ) : <div className="text-center py-16 text-dim text-[11px] font-mono">Clique sur <span className="text-up">⚡ Run</span> pour commencer.</div>}
          </div>
        )}

        {/* HOLDINGS */}
        {tab === "holdings" && (
          <div className="bg-card border border-border rounded-lg p-4">
            <div className="flex justify-between mb-3">
              <span className="text-xs font-semibold text-bright">Positions actives</span>
              <span className="text-[10px] text-dim font-mono">Total positions: {fmt(hVal, 0)} {cur}</span>
            </div>
            {fH.length === 0 ? <div className="text-dim text-[11px] text-center py-10 font-mono">—</div> : (
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead><tr className="border-b border-border">
                    {["Ticker", "Cpt", "Broker", "Qté", "PRU", "Cours", "Valeur", "P&L", ""].map(h => (
                      <th key={h} className="text-left py-1.5 px-2 text-dim font-medium text-[9px] uppercase tracking-wider">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {fH.sort((a, b) => Number(b.shares) * Number(b.last_price || 0) - Number(a.shares) * Number(a.last_price || 0)).map(h => {
                      const sa = subAccounts.find(x => x.id === h.sub_account_id);
                      const a = accounts.find(x => x.id === h.account_id);
                      const isCto = a?.currency === "USD";
                      const hCur = isCto ? "$" : "€";
                      const pruNative = isCto && h.avg_cost > 0 ? h.avg_cost / latestFx : h.avg_cost;
                      const v = Number(h.shares) * Number(h.last_price || 0);
                      const pnl = pruNative > 0 ? (Number(h.last_price || 0) - pruNative) * Number(h.shares) : null;
                      const pP = pruNative > 0 ? ((Number(h.last_price || 0) / pruNative) - 1) * 100 : null;
                      const brokerColor = sa?.brokers?.color || "#6b7280";
                      return (
                        <tr key={h.id} className="row-hover border-b border-border/10">
                          <td className="py-[7px] px-2 font-mono font-semibold text-bright">
                            {h.ticker}
                            {h.label && <div className="text-[9px] text-dim font-normal">{h.label}</div>}
                          </td>
                          <td className="py-[7px] px-2 text-[9px] text-dim font-mono">{a?.type}</td>
                          <td className="py-[7px] px-2 text-[9px] font-mono">
                            <span className="inline-flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full" style={{ background: brokerColor }} />
                              <span className="text-muted">{subAccLabel(sa)}</span>
                            </span>
                          </td>
                          <td className="py-[7px] px-2 font-mono">{fmt(h.shares, Number(h.shares) % 1 === 0 ? 0 : 2)}</td>
                          <td className="py-[7px] px-2 font-mono text-muted">
                            {Number(h.avg_cost) > 0 ? (
                              <>{fmt(pruNative)}{hCur}{isCto && <div className="text-[8px] text-dim">{fmt(h.avg_cost)}€</div>}</>
                            ) : "—"}
                          </td>
                          <td className="py-[7px] px-2 font-mono">{Number(h.last_price) > 0 ? `${fmt(h.last_price)}${hCur}` : "—"}</td>
                          <td className="py-[7px] px-2 font-mono">{fmt(v, 0)}{hCur}</td>
                          <td className="py-[7px] px-2 font-mono" style={{ color: pnl != null ? (pnl >= 0 ? C.green : C.red) : C.dim }}>
                            {pnl != null ? <>{pnl >= 0 ? "+" : ""}{fmt(pnl, 0)}{hCur} <span className="text-[9px]">{fmtPct(pP!)}</span></> : "—"}
                          </td>
                          <td className="py-[7px] px-2 flex gap-1.5">
                            <button onClick={() => { setForm({ id: h.id, ticker: h.ticker, label: h.label || "", shares: h.shares, avg_cost: h.avg_cost }); setModal("editholding"); }} className="text-dim hover:text-accent"><Pencil size={10} /></button>
                            <button onClick={() => delItem("holdings", h.id)} className="text-dim hover:text-down"><Trash2 size={10} /></button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {closedH.length > 0 && <div className="mt-3.5 pt-2.5 border-t border-border text-[10px] text-dim">Fermées: {closedH.map(h => h.ticker).join(", ")}</div>}
          </div>
        )}

        {/* ACTIVITY */}
        {tab === "activity" && (
          <div className="bg-card border border-border rounded-lg p-4 max-h-[500px] overflow-auto">
            {[...fC.map(c => ({ ...c, _t: "cash" as const, _d: c.date })), ...fP.map(p => ({ ...p, _t: "pnl" as const, _d: p.date }))]
              .sort((a, b) => b._d.localeCompare(a._d)).map((it: any, i) => {
                const sa = subAccounts.find(x => x.id === it.sub_account_id);
                return (
                  <div key={i} className="row-hover flex justify-between items-center py-2 px-1.5 border-b border-border/10 rounded">
                    <div>
                      <div className="text-xs font-medium text-bright">
                        {it._t === "cash" ? (Number(it.amount) > 0 ? "↗ Dépôt" : "↘ Retrait") : "⚡ P&L"}
                        {it.ticker && <span className="text-dim font-mono ml-1.5 text-[10px]">{it.ticker}</span>}
                      </div>
                      <div className="text-[9px] text-dim font-mono">
                        {it._d}{sa ? ` · ${subAccLabel(sa)}` : ""}{it.description ? ` · ${it.description}` : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold" style={{ color: Number(it.amount) >= 0 ? C.green : C.red }}>
                        {Number(it.amount) >= 0 ? "+" : ""}{fmt(Number(it.amount))}€
                      </span>
                      <button onClick={() => it._t === "cash" ? delCashMovement(it as any) : delRealizedPnl(it as any)} className="text-dim hover:text-down"><Trash2 size={9} /></button>
                    </div>
                  </div>
                );
              })}
            {fC.length === 0 && fP.length === 0 && <div className="text-dim text-[11px] text-center py-10 font-mono">—</div>}
          </div>
        )}

        {/* TRADES */}
        {tab === "trades" && (
          <div className="bg-card border border-border rounded-lg p-4 max-h-[500px] overflow-auto">
            <div className="text-[10px] text-dim mb-3 font-mono">Un trade met à jour automatiquement la position + cash du sub-account</div>
            {fT.length === 0 ? <div className="text-dim text-[11px] text-center py-10 font-mono">—</div> : (
              <table className="w-full text-[11px]">
                <thead><tr className="border-b border-border">
                  {["Date", "Ticker", "Broker", "Side", "Qté", "Prix", "Total", "Frais", "Notes", ""].map(h => (
                    <th key={h} className="text-left py-1.5 px-2 text-dim font-medium text-[9px] uppercase">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {fT.map(t => {
                    const sa = subAccounts.find(x => x.id === t.sub_account_id);
                    return (
                      <tr key={t.id} className="row-hover border-b border-border/10">
                        <td className="py-1.5 px-2 font-mono text-[10px]">{t.date}</td>
                        <td className="py-1.5 px-2 font-mono font-semibold text-bright">{t.ticker}</td>
                        <td className="py-1.5 px-2 text-[9px] font-mono">
                          {sa ? (
                            <span className="inline-flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full" style={{ background: sa.brokers?.color || "#6b7280" }} />
                              <span className="text-muted">{sa.brokers?.name || "—"}</span>
                            </span>
                          ) : <span className="text-dim">—</span>}
                        </td>
                        <td className="py-1.5 px-2">
                          <span className={`text-[9px] font-semibold font-mono py-0.5 px-1.5 rounded ${t.side === "BUY" ? "text-up bg-up-bg" : "text-down bg-down-bg"}`}>{t.side}</span>
                        </td>
                        <td className="py-1.5 px-2 font-mono">{fmt(t.shares, Number(t.shares) % 1 === 0 ? 0 : 2)}</td>
                        <td className="py-1.5 px-2 font-mono">{fmt(t.price)}</td>
                        <td className="py-1.5 px-2 font-mono">{fmt(Number(t.shares) * Number(t.price), 0)}</td>
                        <td className="py-1.5 px-2 font-mono text-dim">{Number(t.fees) > 0 ? fmt(t.fees) : "—"}</td>
                        <td className="py-1.5 px-2 text-[9px] text-dim">{t.notes || ""}</td>
                        <td className="py-1.5 px-2"><button onClick={() => delTrade(t)} className="text-dim hover:text-down"><Trash2 size={9} /></button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* SNAPSHOTS */}
        {tab === "snaps" && (
          <div className="bg-card border border-border rounded-lg p-4 max-h-[500px] overflow-auto">
            <table className="w-full text-[10px]">
              <thead><tr className="border-b border-border">
                {["Date", "Cpt", "PTF (natif)", "Idx adj.", "Cash (€)", "FX", "✓"].map(h => (
                  <th key={h} className="text-left py-1.5 px-2 text-dim font-medium text-[9px] uppercase">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {snaps.filter(s => accIds.has(s.account_id)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 50).map((s, i) => {
                  const a = accounts.find(x => x.id === s.account_id);
                  const hCur = a?.currency === "USD" ? "$" : "€";
                  return (
                    <tr key={s.id || i} className="row-hover border-b border-border/10">
                      <td className="py-1 px-2 font-mono">{s.date}</td>
                      <td className="py-1 px-2 font-medium">{a?.type}</td>
                      <td className="py-1 px-2 font-mono">{fmt(s.portfolio_value)}{hCur}</td>
                      <td className="py-1 px-2 font-mono text-muted">{fmt(s.index_value)}{hCur}</td>
                      <td className="py-1 px-2 font-mono text-dim">{fmt(s.cash)}€</td>
                      <td className="py-1 px-2 font-mono text-dim">{s.fx_rate ? fmt(s.fx_rate, 4) : "—"}</td>
                      <td className="py-1 px-2">{s.confirmed ? <Check size={10} color={C.green} /> : <span className="text-dim">·</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ═══ MODALS ═══ */}
      <Modal open={modal === "cash"} onClose={() => setModal(null)} title="Dépôt / Retrait (EUR)">
        <Sel label="Sub-account" options={allSubAccOptions}
          value={form.sub_account_id} onChange={(e: any) => setForm({ ...form, sub_account_id: e.target.value })} />
        <Inp label="Date" type="date" value={form.date} onChange={(e: any) => setForm({ ...form, date: e.target.value })} />
        <Inp label="Montant en EUR (négatif = retrait)" type="number" placeholder="500" value={form.amount} onChange={(e: any) => setForm({ ...form, amount: e.target.value })} />
        <Inp label="Description" value={form.description} placeholder="Dépôt mensuel" onChange={(e: any) => setForm({ ...form, description: e.target.value })} />
        <Btn onClick={addCash} className="w-full" disabled={!form.amount || !form.sub_account_id}>Enregistrer</Btn>
      </Modal>

      <Modal open={modal === "trade"} onClose={() => setModal(null)} title="Trade (sub-account = broker)">
        {(() => {
          const tradeCcy = form.tradeCcy || "EUR";
          const autoFx = latestFxMap[tradeCcy] || 0;
          const usedFx = tradeCcy === "EUR" ? 1 : (Number(form.tradeFx) || autoFx);
          const priceEur = form.price && usedFx > 0 ? Number(form.price) * usedFx : 0;
          return <>
            <Sel label="Sub-account (broker)" options={allSubAccOptions}
              value={form.sub_account_id} onChange={(e: any) => setForm({ ...form, sub_account_id: e.target.value })} />
            <Inp label="Date" type="date" value={form.date} onChange={(e: any) => setForm({ ...form, date: e.target.value })} />
            <Sel label="Side" options={[{ value: "BUY", label: "BUY" }, { value: "SELL", label: "SELL" }]} value={form.side} onChange={(e: any) => setForm({ ...form, side: e.target.value })} />
            <Inp label="Ticker" value={form.ticker} placeholder="AAPL" onChange={(e: any) => setForm({ ...form, ticker: e.target.value })} />
            <div className="flex gap-2">
              <Inp label="Quantité" type="number" step="any" value={form.shares} placeholder="10" onChange={(e: any) => setForm({ ...form, shares: e.target.value })} />
              <div className="flex gap-1 flex-1">
                <div className="flex-1">
                  <Inp label="Prix unitaire" type="number" step=".01" value={form.price} placeholder="150" onChange={(e: any) => setForm({ ...form, price: e.target.value })} />
                </div>
                <div className="w-[80px]">
                  <Sel label="Devise" options={[
                    { value: "EUR", label: "EUR" }, { value: "USD", label: "USD" },
                    { value: "CAD", label: "CAD" }, { value: "AUD", label: "AUD" },
                  ]} value={tradeCcy} onChange={(e: any) => {
                    const ccy = e.target.value;
                    setForm({ ...form, tradeCcy: ccy, tradeFx: ccy === "EUR" ? "" : (latestFxMap[ccy] || "") });
                  }} />
                </div>
              </div>
            </div>
            {tradeCcy !== "EUR" && (
              <div className="flex gap-2 items-end mb-2">
                <div className="flex-1">
                  <Inp label={`Taux ${tradeCcy}→EUR`} type="number" step="any" value={form.tradeFx || autoFx || ""} placeholder="0.87"
                    onChange={(e: any) => setForm({ ...form, tradeFx: e.target.value })} />
                </div>
                {priceEur > 0 && (
                  <div className="text-[10px] text-dim font-mono pb-4">
                    = {fmt(priceEur)}€
                  </div>
                )}
              </div>
            )}
            <div className="flex gap-2">
              <Inp label="Frais" type="number" step=".01" value={form.fees} placeholder="0" onChange={(e: any) => setForm({ ...form, fees: e.target.value })} />
              <Inp label="Notes" value={form.notes} onChange={(e: any) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <Btn onClick={addTrade} className="w-full" disabled={!form.ticker || !form.shares || !form.price || !form.sub_account_id}>{form.side || "BUY"}</Btn>
          </>;
        })()}
      </Modal>

      <Modal open={modal === "pnl"} onClose={() => setModal(null)}
        title={form.isDividend ? "💰 Dividende reçu" : "+/- Value réalisée"}>

        {/* Toggle dividende vs P&L */}
        <div className="mb-4 flex gap-1 bg-bg rounded-md p-0.5">
          <button
            onClick={() => setForm({ ...form, isDividend: false })}
            className={`flex-1 py-1.5 px-3 rounded text-[11px] font-medium transition-all
              ${!form.isDividend
                ? "bg-card text-bright border border-border"
                : "bg-transparent text-dim border border-transparent"}`}>
            P&L / frais
          </button>
          <button
            onClick={() => setForm({ ...form, isDividend: true })}
            className={`flex-1 py-1.5 px-3 rounded text-[11px] font-medium transition-all
              ${form.isDividend
                ? "bg-card text-[#fbbf24] border border-[#fbbf24]/40"
                : "bg-transparent text-dim border border-transparent"}`}>
            💰 Dividende
          </button>
        </div>

        <div className="text-[10px] text-dim mb-3 font-mono">
          {form.isDividend
            ? "Crédité sur le cash du sub-account + traqué séparément dans les stats dividendes."
            : "Ajuste le cash du sub-account. Frais, PV/MV réalisée, pertes de transfert, etc."}
        </div>

        <Sel label="Sub-account" options={allSubAccOptions}
          value={form.sub_account_id} onChange={(e: any) => setForm({ ...form, sub_account_id: e.target.value })} />
        <Inp label="Date" type="date" value={form.date} onChange={(e: any) => setForm({ ...form, date: e.target.value })} />
        <Inp label="Ticker (optionnel)" value={form.ticker} placeholder="AAPL" onChange={(e: any) => setForm({ ...form, ticker: e.target.value })} />

        {form.isDividend ? (
          <>
            {/* Montant en devise native + conversion auto */}
            <div className="flex gap-2">
              <Inp label="Montant reçu" type="number" step="0.01"
                value={form.amountNative || ""}
                placeholder="50"
                onChange={(e: any) => {
                  const v = e.target.value;
                  const ccy = form.dividendCcy || "EUR";
                  const fx = ccy === "EUR" ? 1 : (Number(form.dividendFx) || latestFxMap[ccy] || 1);
                  setForm({ ...form, amountNative: v, amount: Number(v) * fx });
                }} />
              <div className="w-[90px]">
                <Sel label="Devise" options={[
                  { value: "EUR", label: "EUR" }, { value: "USD", label: "USD" },
                  { value: "CAD", label: "CAD" }, { value: "AUD", label: "AUD" }, { value: "GBP", label: "GBP" },
                ]} value={form.dividendCcy || "EUR"} onChange={(e: any) => {
                  const ccy = e.target.value;
                  const fx = ccy === "EUR" ? 1 : (latestFxMap[ccy] || 1);
                  setForm({
                    ...form, dividendCcy: ccy, dividendFx: ccy === "EUR" ? "" : fx,
                    amount: Number(form.amountNative || 0) * fx,
                  });
                }} />
              </div>
            </div>

            {form.dividendCcy && form.dividendCcy !== "EUR" && (
              <div className="flex gap-2 items-end mb-2">
                <div className="flex-1">
                  <Inp label={`Taux ${form.dividendCcy}→EUR`} type="number" step="any"
                    value={form.dividendFx || latestFxMap[form.dividendCcy] || ""}
                    onChange={(e: any) => {
                      const fx = Number(e.target.value);
                      setForm({ ...form, dividendFx: e.target.value, amount: Number(form.amountNative || 0) * fx });
                    }} />
                </div>
                {Number(form.amount) > 0 && (
                  <div className="text-[10px] text-dim font-mono pb-4">
                    = {fmt(Number(form.amount), 2)}€
                  </div>
                )}
              </div>
            )}

            <Inp label="Retenue à la source (optionnel)" type="number" step="0.01"
              value={form.withholdingTax || ""} placeholder="0"
              onChange={(e: any) => setForm({ ...form, withholdingTax: e.target.value })} />
          </>
        ) : (
          <Inp label="Montant EUR (négatif = perte)" type="number" step=".01"
            placeholder="-120.50" value={form.amount}
            onChange={(e: any) => setForm({ ...form, amount: e.target.value })} />
        )}

        <Inp label="Description" value={form.description}
          placeholder={form.isDividend ? "Dividende trimestriel" : ""}
          onChange={(e: any) => setForm({ ...form, description: e.target.value })} />

        <Btn onClick={addPnl} className="w-full"
          disabled={form.isDividend ? (!form.amountNative || !form.sub_account_id) : (!form.amount || !form.sub_account_id)}>
          {form.isDividend ? "Enregistrer le dividende" : "Enregistrer"}
        </Btn>
      </Modal>

      <Modal open={modal === "holding"} onClose={() => setModal(null)} title="Ajouter / éditer une position">
        <div className="text-[10px] text-dim mb-3 font-mono">Import manuel. Pour un achat/vente, utilise plutôt Trade.</div>
        <Sel label="Sub-account" options={allSubAccOptions}
          value={form.sub_account_id} onChange={(e: any) => setForm({ ...form, sub_account_id: e.target.value })} />
        <Inp label="Ticker" value={form.ticker} placeholder="AAPL" onChange={(e: any) => setForm({ ...form, ticker: e.target.value })} />
        <Inp label="Nom" value={form.label} placeholder="Apple Inc." onChange={(e: any) => setForm({ ...form, label: e.target.value })} />
        <div className="flex gap-2">
          <Inp label="Quantité" type="number" step="any" value={form.shares} placeholder="10" onChange={(e: any) => setForm({ ...form, shares: e.target.value })} />
          <Inp label="PRU" type="number" step=".01" value={form.avg_cost} placeholder="150" onChange={(e: any) => setForm({ ...form, avg_cost: e.target.value })} />
        </div>
        <Inp label="Dernier cours" type="number" step=".01" value={form.last_price} placeholder="175" onChange={(e: any) => setForm({ ...form, last_price: e.target.value })} />
        <Btn onClick={addHolding} className="w-full" disabled={!form.ticker || !form.shares || !form.sub_account_id}>Ajouter</Btn>
      </Modal>

      <Modal open={modal === "editholding"} onClose={() => setModal(null)} title={`Modifier ${form.ticker || ""}`}>
        <div className="text-[10px] text-dim mb-3 font-mono">{form.ticker} — PRU toujours en EUR (converti au taux spot pour CTO)</div>
        <Inp label="Quantité" type="number" step="any" value={form.shares} onChange={(e: any) => setForm({ ...form, shares: e.target.value })} />
        <Inp label="PRU (EUR)" type="number" step=".01" value={form.avg_cost} onChange={(e: any) => setForm({ ...form, avg_cost: e.target.value })} />
        <Inp label="Nom" value={form.label} placeholder="" onChange={(e: any) => setForm({ ...form, label: e.target.value })} />
        <Btn onClick={editHolding} className="w-full">Sauvegarder</Btn>
      </Modal>

      <Modal open={modal === "logs"} onClose={() => setModal(null)} title="Update logs">
        <div className="font-mono text-[10px] space-y-1 max-h-[400px] overflow-auto">
          {updateLog?.map((l: any, i: number) => (
            <div key={i} className={l.level === "error" ? "text-down" : l.level === "warn" ? "text-[#d29922]" : "text-dim"}>
              {l.msg}
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}