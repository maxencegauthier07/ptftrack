"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import type { Loan, Property, LoanType, Currency } from "@/lib/types";
import { Plus, Pencil, Trash2, X, CreditCard, Home, GraduationCap, ShoppingBag } from "lucide-react";

const fmt = (n: number | null | undefined, d = 2) =>
  n == null ? "—" : Number(n).toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });

const C = {
  accent: "#58a6ff", green: "#3fb950", red: "#f85149",
  border: "#1b2332", dim: "#484f58", muted: "#6e7681", bright: "#e6edf3",
};

const TYPE_LABELS: Record<LoanType, string> = {
  mortgage: "Prêt immobilier",
  consumer: "Prêt conso",
  student: "Prêt étudiant",
  other: "Autre",
};

const TYPE_ICONS: Record<LoanType, any> = {
  mortgage: Home, consumer: ShoppingBag, student: GraduationCap, other: CreditCard,
};

const CURRENCIES: Currency[] = ["EUR", "USD", "CAD", "AUD", "GBP"];

export default function LoansView({ personId }: { personId: string }) {
  const [loading, setLoading] = useState(true);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [modal, setModal] = useState<"new" | "edit" | null>(null);
  const [form, setForm] = useState<any>({});

  const notify = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2000); };

  const load = useCallback(async () => {
    setLoading(true);
    const [lR, pR] = await Promise.all([
      supabase.from("loans").select("*, properties(name)").eq("person_id", personId).order("type"),
      supabase.from("properties").select("*").eq("person_id", personId).order("name"),
    ]);
    setLoans((lR.data || []) as Loan[]);
    setProperties((pR.data || []) as Property[]);
    setLoading(false);
  }, [personId]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    try {
      const payload = {
        person_id: personId,
        property_id: form.property_id || null,
        name: form.name.trim(),
        type: form.type || "mortgage",
        principal: Number(form.principal || 0),
        current_balance: Number(form.current_balance || 0),
        rate: form.rate ? Number(form.rate) : null,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        monthly_payment: form.monthly_payment ? Number(form.monthly_payment) : null,
        currency: form.currency || "EUR",
        notes: form.notes?.trim() || null,
      };
      if (modal === "edit" && form.id) {
        await supabase.from("loans").update({
          ...payload, updated_at: new Date().toISOString(),
        }).eq("id", form.id);
        notify("✓ Modifié");
      } else {
        await supabase.from("loans").insert(payload);
        notify("✓ Prêt créé");
      }
      setModal(null); setForm({}); load();
    } catch (e: any) { setErr(e.message); }
  };

  const del = async (id: string, name: string) => {
    if (!confirm(`Supprimer "${name}" ?`)) return;
    await supabase.from("loans").delete().eq("id", id);
    notify("✓ Supprimé"); load();
  };

  // % remboursé
  const repaymentPct = (l: Loan) => {
    const p = Number(l.principal || 0);
    const b = Number(l.current_balance || 0);
    if (p <= 0) return 0;
    return ((p - b) / p) * 100;
  };

  const byCurrency = useMemo(() => {
    const m: Record<string, { debt: number; monthly: number }> = {};
    for (const l of loans) {
      if (!m[l.currency]) m[l.currency] = { debt: 0, monthly: 0 };
      m[l.currency].debt += Number(l.current_balance || 0);
      m[l.currency].monthly += Number(l.monthly_payment || 0);
    }
    return m;
  }, [loans]);

  const grouped = useMemo(() => {
    const g: Record<string, Loan[]> = {};
    for (const l of loans) {
      if (!g[l.type]) g[l.type] = [];
      g[l.type].push(l);
    }
    return g;
  }, [loans]);

  if (loading) {
    return <div className="flex items-center justify-center py-20"><span className="font-mono text-dim text-sm">loading...</span></div>;
  }

  return (
    <div>
      {toast && <div className="fixed top-3 right-3 z-50 bg-up text-white py-2 px-4 rounded-md text-xs font-mono animate-fade-up shadow-lg shadow-black/40">{toast}</div>}

      <div className="border-b border-border py-2 px-5 flex items-center justify-between">
        <span className="text-[10px] text-dim uppercase tracking-widest">Dettes</span>
        <div className="flex gap-4 text-[11px] font-mono">
          {Object.entries(byCurrency).map(([ccy, t]) => (
            <span key={ccy} className="text-muted">
              Dû : <span className="text-down font-semibold">{fmt(t.debt, 0)}</span> {ccy}
              {t.monthly > 0 && <span className="text-dim"> · {fmt(t.monthly, 0)}/mois</span>}
            </span>
          ))}
        </div>
      </div>

      <div className="p-4 md:p-5 max-w-[1280px] mx-auto">
        {err && (
          <div className="bg-down-bg border border-down/30 rounded-md py-2 px-3.5 mb-3.5 text-down text-[11px] font-mono flex justify-between items-start">
            <span className="break-all">{err}</span>
            <button onClick={() => setErr(null)} className="ml-3 shrink-0">×</button>
          </div>
        )}

        <div className="flex justify-between items-center mb-4">
          <span className="text-bright text-sm font-semibold">{loans.length} prêt{loans.length > 1 ? "s" : ""}</span>
          <button onClick={() => { setForm({ type: "mortgage", currency: "EUR" }); setModal("new"); }}
            className="py-[5px] px-[10px] bg-accent text-white rounded-md text-[11px] font-medium inline-flex items-center gap-1.5">
            <Plus size={11} /> Nouveau prêt
          </button>
        </div>

        {loans.length === 0 ? (
          <div className="bg-card border border-border rounded-lg py-16 text-center">
            <CreditCard size={28} className="mx-auto text-dim mb-3" />
            <div className="text-muted text-[12px] mb-1">Aucun prêt</div>
            <div className="text-dim text-[10px] font-mono">Ajoute un prêt immo, conso, étudiant...</div>
          </div>
        ) : (
          <div className="space-y-5">
            {Object.entries(grouped).map(([type, ls]) => {
              const Ico = TYPE_ICONS[type as LoanType] || CreditCard;
              const subDebt = ls.reduce((s, l) => s + Number(l.current_balance || 0), 0);
              const sameCcy = ls.every(l => l.currency === ls[0].currency);
              return (
                <div key={type}>
                  <div className="flex items-center gap-2 mb-2 px-1">
                    <Ico size={13} color={C.muted} />
                    <span className="text-muted text-[11px] font-semibold uppercase tracking-wider">{TYPE_LABELS[type as LoanType]}</span>
                    <span className="text-dim text-[10px] font-mono">({ls.length})</span>
                    {sameCcy && (
                      <span className="text-dim text-[10px] font-mono ml-auto">
                        Dû : <span className="text-down font-semibold">{fmt(subDebt, 0)}</span> {ls[0].currency}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                    {ls.map(l => {
                      const pct = repaymentPct(l);
                      return (
                        <div key={l.id} className="bg-card border border-border rounded-lg p-3.5 hover:border-dim transition-colors">
                          <div className="flex justify-between items-start mb-2">
                            <div className="flex-1 min-w-0">
                              <div className="text-bright text-[13px] font-semibold truncate">{l.name}</div>
                              {l.properties && (
                                <div className="text-dim text-[10px] font-mono truncate">🏠 {l.properties.name}</div>
                              )}
                            </div>
                            <div className="flex gap-1 shrink-0 ml-2">
                              <button onClick={() => { setForm(l); setModal("edit"); }} className="text-dim hover:text-accent p-0.5"><Pencil size={11} /></button>
                              <button onClick={() => del(l.id, l.name)} className="text-dim hover:text-down p-0.5"><Trash2 size={11} /></button>
                            </div>
                          </div>

                          <div className="space-y-1 text-[11px] font-mono">
                            <div className="flex justify-between">
                              <span className="text-muted">Capital dû</span>
                              <span className="text-down font-bold text-[13px]">{fmt(l.current_balance, 0)} {l.currency}</span>
                            </div>
                            {Number(l.principal) > 0 && (
                              <div className="flex justify-between">
                                <span className="text-dim text-[10px]">Emprunté</span>
                                <span className="text-dim text-[10px]">{fmt(l.principal, 0)} {l.currency}</span>
                              </div>
                            )}
                            {l.rate != null && (
                              <div className="flex justify-between">
                                <span className="text-dim text-[10px]">Taux</span>
                                <span className="text-muted text-[10px]">{fmt(l.rate, 2)}%</span>
                              </div>
                            )}
                            {l.monthly_payment && Number(l.monthly_payment) > 0 && (
                              <div className="flex justify-between">
                                <span className="text-dim text-[10px]">Mensualité</span>
                                <span className="text-muted text-[10px]">{fmt(l.monthly_payment, 0)} {l.currency}</span>
                              </div>
                            )}
                            {(l.start_date || l.end_date) && (
                              <div className="flex justify-between">
                                <span className="text-dim text-[10px]">Période</span>
                                <span className="text-dim text-[10px]">
                                  {l.start_date?.slice(0, 7) || "?"} → {l.end_date?.slice(0, 7) || "?"}
                                </span>
                              </div>
                            )}
                          </div>

                          {/* Progress bar remboursement */}
                          {Number(l.principal) > 0 && (
                            <div className="mt-2.5">
                              <div className="flex justify-between text-[9px] text-dim mb-1">
                                <span>Remboursé</span>
                                <span>{fmt(pct, 1)}%</span>
                              </div>
                              <div className="h-1 bg-bg rounded-full overflow-hidden">
                                <div className="h-full bg-up rounded-full transition-all" style={{ width: `${Math.min(100, pct)}%` }} />
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* MODAL */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={() => setModal(null)}>
          <div onClick={e => e.stopPropagation()} className="bg-card border border-border rounded-xl p-6 w-[92%] max-w-[500px] max-h-[85vh] overflow-auto">
            <div className="flex justify-between items-center mb-5">
              <h3 className="text-bright text-[15px] font-semibold">
                {modal === "new" ? "Nouveau prêt" : "Modifier le prêt"}
              </h3>
              <button onClick={() => setModal(null)} className="text-muted hover:text-bright"><X size={16} /></button>
            </div>

            <div className="mb-3">
              <label className="block text-muted text-[10px] mb-1 uppercase tracking-wider">Nom*</label>
              <input value={form.name || ""} onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="Prêt immo Paris"
                className="w-full py-[7px] px-[10px] bg-bg border border-border rounded-md text-bright text-[13px] outline-none font-mono placeholder:text-dim" />
            </div>

            <div className="flex gap-2">
              <div className="flex-1 mb-3">
                <label className="block text-muted text-[10px] mb-1 uppercase tracking-wider">Type</label>
                <select value={form.type || "mortgage"} onChange={e => setForm({ ...form, type: e.target.value })}
                  className="w-full py-[7px] px-[10px] bg-bg border border-border rounded-md text-bright text-[13px] outline-none font-mono">
                  {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div className="w-[110px] mb-3">
                <label className="block text-muted text-[10px] mb-1 uppercase tracking-wider">Devise</label>
                <select value={form.currency || "EUR"} onChange={e => setForm({ ...form, currency: e.target.value })}
                  className="w-full py-[7px] px-[10px] bg-bg border border-border rounded-md text-bright text-[13px] outline-none font-mono">
                  {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>

            {properties.length > 0 && (form.type === "mortgage" || modal === "edit") && (
              <div className="mb-3">
                <label className="block text-muted text-[10px] mb-1 uppercase tracking-wider">Bien lié (optionnel)</label>
                <select value={form.property_id || ""} onChange={e => setForm({ ...form, property_id: e.target.value })}
                  className="w-full py-[7px] px-[10px] bg-bg border border-border rounded-md text-bright text-[13px] outline-none font-mono">
                  <option value="">— Aucun —</option>
                  {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            )}

            <div className="flex gap-2">
              <div className="flex-1 mb-3">
                <label className="block text-muted text-[10px] mb-1 uppercase tracking-wider">Emprunté</label>
                <input type="number" step=".01" value={form.principal ?? ""} onChange={e => setForm({ ...form, principal: e.target.value })}
                  placeholder="200000"
                  className="w-full py-[7px] px-[10px] bg-bg border border-border rounded-md text-bright text-[13px] outline-none font-mono placeholder:text-dim" />
              </div>
              <div className="flex-1 mb-3">
                <label className="block text-muted text-[10px] mb-1 uppercase tracking-wider">Capital restant*</label>
                <input type="number" step=".01" value={form.current_balance ?? ""} onChange={e => setForm({ ...form, current_balance: e.target.value })}
                  placeholder="180000"
                  className="w-full py-[7px] px-[10px] bg-bg border border-border rounded-md text-bright text-[13px] outline-none font-mono placeholder:text-dim" />
              </div>
            </div>

            <div className="flex gap-2">
              <div className="flex-1 mb-3">
                <label className="block text-muted text-[10px] mb-1 uppercase tracking-wider">Taux %</label>
                <input type="number" step=".01" value={form.rate ?? ""} onChange={e => setForm({ ...form, rate: e.target.value })}
                  placeholder="3.5"
                  className="w-full py-[7px] px-[10px] bg-bg border border-border rounded-md text-bright text-[13px] outline-none font-mono placeholder:text-dim" />
              </div>
              <div className="flex-1 mb-3">
                <label className="block text-muted text-[10px] mb-1 uppercase tracking-wider">Mensualité</label>
                <input type="number" step=".01" value={form.monthly_payment ?? ""} onChange={e => setForm({ ...form, monthly_payment: e.target.value })}
                  placeholder="1200"
                  className="w-full py-[7px] px-[10px] bg-bg border border-border rounded-md text-bright text-[13px] outline-none font-mono placeholder:text-dim" />
              </div>
            </div>

            <div className="flex gap-2">
              <div className="flex-1 mb-3">
                <label className="block text-muted text-[10px] mb-1 uppercase tracking-wider">Début</label>
                <input type="date" value={form.start_date || ""} onChange={e => setForm({ ...form, start_date: e.target.value })}
                  className="w-full py-[7px] px-[10px] bg-bg border border-border rounded-md text-bright text-[13px] outline-none font-mono" />
              </div>
              <div className="flex-1 mb-3">
                <label className="block text-muted text-[10px] mb-1 uppercase tracking-wider">Fin</label>
                <input type="date" value={form.end_date || ""} onChange={e => setForm({ ...form, end_date: e.target.value })}
                  className="w-full py-[7px] px-[10px] bg-bg border border-border rounded-md text-bright text-[13px] outline-none font-mono" />
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-muted text-[10px] mb-1 uppercase tracking-wider">Notes (optionnel)</label>
              <input value={form.notes || ""} onChange={e => setForm({ ...form, notes: e.target.value })}
                className="w-full py-[7px] px-[10px] bg-bg border border-border rounded-md text-bright text-[13px] outline-none font-mono placeholder:text-dim" />
            </div>

            <button onClick={save} disabled={!form.name?.trim()}
              className="w-full py-2 bg-accent text-white rounded-md text-[13px] font-medium disabled:opacity-40">
              {modal === "new" ? "Créer" : "Sauvegarder"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}