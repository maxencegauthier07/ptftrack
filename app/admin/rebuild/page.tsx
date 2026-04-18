"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { ChevronRight, ChevronLeft, Play, Check, X, Loader2, RefreshCw, SkipForward } from "lucide-react";

const fmt = (n: number | null | undefined, d = 2) =>
  n == null ? "—" : Number(n).toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });

// Suivant jour de trading (skip samedi/dimanche)
function nextTradingDay(date: string): string {
  const d = new Date(date);
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() + 1);
  }
  return d.toISOString().slice(0, 10);
}

function prevTradingDay(date: string): string {
  const d = new Date(date);
  d.setDate(d.getDate() - 1);
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() - 1);
  }
  return d.toISOString().slice(0, 10);
}

type PeopleOption = { id: string; name: string };

export default function RebuildAdminPage() {
  const [people, setPeople] = useState<PeopleOption[]>([]);
  const [personId, setPersonId] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("2025-10-31");
  const [currentDate, setCurrentDate] = useState<string>("");
  const [preview, setPreview] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Overrides éditables par compte
  const [overrides, setOverrides] = useState<Record<string, { cashEur?: number; holdings?: Record<string, number> }>>({});

  useEffect(() => {
    supabase.from("people").select("id, name").then(({ data }) => {
      setPeople((data || []) as PeopleOption[]);
    });
  }, []);

  const loadDay = useCallback(async (date: string) => {
    if (!personId) return;
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/rebuild-step?person_id=${personId}&date=${date}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setPreview(data);
      setOverrides({}); // reset overrides quand on change de jour
    } catch (e: any) {
      setMsg("❌ " + e.message);
    } finally {
      setLoading(false);
    }
  }, [personId]);

  const start = async () => {
    setCurrentDate(startDate);
    await loadDay(startDate);
  };

  const validate = async (skipOverrides = false) => {
    if (!personId || !currentDate) return;
    setSaving(true);
    setMsg(null);
    try {
      const body = {
        person_id: personId,
        date: currentDate,
        overrides: skipOverrides ? {} : overrides,
      };
      const res = await fetch("/api/rebuild-step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);

      setMsg(`✅ Snapshot ${currentDate} écrit · NW=${fmt(data.net, 0)}€`);

      // Jour suivant
      const next = nextTradingDay(currentDate);
      setCurrentDate(next);
      await loadDay(next);
    } catch (e: any) {
      setMsg("❌ " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const skip = async () => {
    const next = nextTradingDay(currentDate);
    setCurrentDate(next);
    await loadDay(next);
  };

  const prev = async () => {
    const p = prevTradingDay(currentDate);
    setCurrentDate(p);
    await loadDay(p);
  };

  const updateCashOverride = (accId: string, value: string) => {
    const n = parseFloat(value);
    setOverrides(prev => ({
      ...prev,
      [accId]: {
        ...prev[accId],
        cashEur: isNaN(n) ? undefined : n,
      },
    }));
  };

  const updateHoldingOverride = (accId: string, ticker: string, value: string) => {
    const n = parseFloat(value);
    setOverrides(prev => ({
      ...prev,
      [accId]: {
        ...prev[accId],
        holdings: {
          ...(prev[accId]?.holdings || {}),
          [ticker]: isNaN(n) ? 0 : n,
        },
      },
    }));
  };

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text-1)] p-6">
      <div className="max-w-[1280px] mx-auto">
        <h1 className="text-xl font-semibold mb-4">🛠 Rebuild Jour par Jour</h1>

        {/* Setup */}
        <div className="card-static p-4 mb-4">
          <div className="flex gap-3 flex-wrap items-end">
            <div>
              <label className="block text-[10px] text-[var(--text-3)] mb-1 uppercase tracking-wider">Personne</label>
              <select value={personId} onChange={e => setPersonId(e.target.value)}
                className="bg-[var(--bg-raised)] border border-[var(--border)] rounded px-3 py-1.5 text-sm min-w-[200px]">
                <option value="">— choisir —</option>
                {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-[var(--text-3)] mb-1 uppercase tracking-wider">Début</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                className="bg-[var(--bg-raised)] border border-[var(--border)] rounded px-3 py-1.5 text-sm font-mono" />
            </div>
            <button onClick={start} disabled={!personId}
              className="btn btn-primary">
              <Play size={12} /> Démarrer
            </button>
            {currentDate && (
              <button onClick={() => loadDay(currentDate)} className="btn btn-ghost">
                <RefreshCw size={12} /> Recharger
              </button>
            )}
          </div>
          {msg && <div className="mt-2 text-xs font-mono">{msg}</div>}
        </div>

        {/* Navigation */}
        {currentDate && (
          <div className="card-static p-4 mb-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button onClick={prev} disabled={loading || saving} className="btn btn-ghost">
                <ChevronLeft size={12} /> Précédent
              </button>
              <div className="text-lg font-mono font-semibold">{currentDate}</div>
              <button onClick={skip} disabled={loading || saving} className="btn btn-ghost">
                Skip <SkipForward size={12} />
              </button>
            </div>
            <div className="flex gap-2">
              <button onClick={() => validate(true)} disabled={loading || saving} className="btn btn-ghost text-xs">
                Valider sans édits
              </button>
              <button onClick={() => validate(false)} disabled={loading || saving} className="btn btn-primary">
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                {saving ? "..." : "Valider + jour suivant"}
              </button>
            </div>
          </div>
        )}

        {/* Preview */}
        {loading && (
          <div className="card-static p-8 text-center text-[var(--text-3)] font-mono text-sm">
            <Loader2 size={16} className="animate-spin inline mr-2" /> chargement...
          </div>
        )}

        {preview && !loading && (
          <>
            {/* Résumé */}
            <div className="card-static p-4 mb-4">
              <div className="flex items-baseline gap-4 flex-wrap">
                <div>
                  <div className="text-[10px] text-[var(--text-3)] uppercase tracking-wider">Portfolio EUR</div>
                  <div className="text-2xl font-mono font-semibold">{fmt(preview.totalPtfEur, 0)}€</div>
                </div>
                <div>
                  <div className="text-[10px] text-[var(--text-3)] uppercase tracking-wider">FX du jour</div>
                  <div className="font-mono">{fmt(preview.dayFx, 4)}</div>
                </div>
                {preview.existingSnaps?.length > 0 && (
                  <div className="text-xs text-[var(--green)] font-mono">
                    ✓ {preview.existingSnaps.length} snapshot(s) déjà existant(s)
                  </div>
                )}
              </div>
            </div>

            {/* Events du jour */}
            {(preview.dayEvents.trades.length > 0 ||
              preview.dayEvents.cashMovs.length > 0 ||
              preview.dayEvents.pnls.length > 0 ||
              preview.dayEvents.dividends.length > 0) && (
              <div className="card-static p-4 mb-4">
                <div className="text-sm font-semibold mb-2">📅 Events ce jour</div>
                <div className="space-y-1 text-xs font-mono">
                  {preview.dayEvents.cashMovs.map((cm: any, i: number) => (
                    <div key={i} className="flex justify-between">
                      <span>💰 CASH: {cm.description}</span>
                      <span style={{ color: Number(cm.amount) >= 0 ? "var(--green)" : "var(--red)" }}>
                        {Number(cm.amount) >= 0 ? "+" : ""}{fmt(Number(cm.amount))}€
                      </span>
                    </div>
                  ))}
                  {preview.dayEvents.trades.map((t: any, i: number) => (
                    <div key={i} className="flex justify-between">
                      <span>🔄 {t.side} {t.ticker}: {fmt(t.shares)} × {fmt(t.price)}</span>
                      <span className="text-[var(--text-3)]">{t.notes || ""}</span>
                    </div>
                  ))}
                  {preview.dayEvents.pnls.map((p: any, i: number) => (
                    <div key={i} className="flex justify-between">
                      <span>⚡ PNL: {p.description}</span>
                      <span style={{ color: Number(p.amount) >= 0 ? "var(--green)" : "var(--red)" }}>
                        {Number(p.amount) >= 0 ? "+" : ""}{fmt(Number(p.amount))}€
                      </span>
                    </div>
                  ))}
                  {preview.dayEvents.dividends.map((d: any, i: number) => (
                    <div key={i} className="flex justify-between">
                      <span>💎 DIV {d.ticker}</span>
                      <span className="text-[var(--green)]">+{fmt(Number(d.amount))}€</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Par compte */}
            {Object.entries(preview.preview).map(([accId, acc]: any) => (
              <div key={accId} className="card-static p-4 mb-4">
                <div className="flex items-baseline justify-between mb-3">
                  <div>
                    <span className="text-sm font-semibold">{acc.accountType}</span>
                    <span className="text-[var(--text-3)] text-xs ml-2">({acc.currency})</span>
                  </div>
                  <div className="font-mono text-sm">
                    <span className="text-[var(--text-3)]">Total: </span>
                    <span className="font-semibold">{fmt(acc.ptfEur, 2)}€</span>
                  </div>
                </div>

                {/* Cash avec édition */}
                <div className="mb-3 flex items-center gap-3">
                  <span className="text-xs font-mono text-[var(--text-3)] w-20">Cash (EUR)</span>
                  <input
                    type="number"
                    step="0.01"
                    defaultValue={acc.cashEur}
                    onChange={e => updateCashOverride(accId, e.target.value)}
                    className="bg-[var(--bg-raised)] border border-[var(--border)] rounded px-2 py-1 text-sm font-mono w-32"
                  />
                  {overrides[accId]?.cashEur !== undefined && (
                    <span className="text-[10px] text-[var(--amber)]">édité (calc: {fmt(acc.cashEur)})</span>
                  )}
                </div>

                {/* Holdings */}
                {acc.holdings.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-[var(--text-3)] border-b border-[var(--border)]">
                          <th className="text-left py-1.5 px-2">Ticker</th>
                          <th className="text-right py-1.5 px-2">Parts</th>
                          <th className="text-right py-1.5 px-2">Prix natif</th>
                          <th className="text-right py-1.5 px-2">Prix EUR</th>
                          <th className="text-right py-1.5 px-2">Valeur EUR</th>
                        </tr>
                      </thead>
                      <tbody>
                        {acc.holdings.map((h: any) => (
                          <tr key={h.ticker} className="border-b border-[var(--border)]/30">
                            <td className="py-1.5 px-2 font-mono font-semibold">
                              {h.ticker}
                              {!h.priceAvailable && <span className="ml-1 text-[10px] text-[var(--red)]">⚠ pas de prix</span>}
                            </td>
                            <td className="py-1.5 px-2 text-right">
                              <input
                                type="number"
                                step="any"
                                defaultValue={h.shares}
                                onChange={e => updateHoldingOverride(accId, h.ticker, e.target.value)}
                                className="bg-[var(--bg-raised)] border border-[var(--border)] rounded px-1.5 py-0.5 text-xs font-mono w-20 text-right"
                              />
                            </td>
                            <td className="py-1.5 px-2 text-right font-mono text-[var(--text-3)]">
                              {fmt(h.priceNative, 4)} {h.priceCcy}
                            </td>
                            <td className="py-1.5 px-2 text-right font-mono text-[var(--text-3)]">
                              {fmt(h.priceEur, 4)}
                            </td>
                            <td className="py-1.5 px-2 text-right font-mono">
                              {fmt(h.valueEur, 2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-xs text-[var(--text-3)] font-mono italic">Aucune position</div>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}