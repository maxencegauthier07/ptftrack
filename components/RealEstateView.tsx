"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import type { Property, Loan, PropertyType, Currency } from "@/lib/types";
import { Plus, Pencil, Trash2, X, Home, Building2, Trees, Briefcase } from "lucide-react";

const fmt = (n: number | null | undefined, d = 2) =>
  n == null ? "—" : Number(n).toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });

const C = {
  accent: "#58a6ff", green: "#3fb950", red: "#f85149",
  border: "#1b2332", dim: "#484f58", muted: "#6e7681", bright: "#e6edf3",
};

const TYPE_LABELS: Record<PropertyType, string> = {
  residence: "Résidence principale",
  rental: "Locatif",
  secondary: "Résidence secondaire",
  land: "Terrain",
  other: "Autre",
};

const TYPE_ICONS: Record<PropertyType, any> = {
  residence: Home, rental: Briefcase, secondary: Home, land: Trees, other: Building2,
};

const CURRENCIES: Currency[] = ["EUR", "USD", "CAD", "AUD", "GBP"];

export default function RealEstateView({ personId }: { personId: string }) {
  const [loading, setLoading] = useState(true);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [modal, setModal] = useState<"new" | "edit" | null>(null);
  const [form, setForm] = useState<any>({});

  const notify = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2000); };

  const load = useCallback(async () => {
    setLoading(true);
    const [pR, lR] = await Promise.all([
      supabase.from("properties").select("*").eq("person_id", personId).order("name"),
      supabase.from("loans").select("*").eq("person_id", personId),
    ]);
    setProperties((pR.data || []) as Property[]);
    setLoans((lR.data || []) as Loan[]);
    setLoading(false);
  }, [personId]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    try {
      const payload = {
        person_id: personId,
        name: form.name.trim(),
        type: form.type || "residence",
        address: form.address?.trim() || null,
        purchase_date: form.purchase_date || null,
        purchase_price: Number(form.purchase_price || 0),
        current_value: Number(form.current_value || 0),
        currency: form.currency || "EUR",
        ownership_pct: Number(form.ownership_pct || 100),
        notes: form.notes?.trim() || null,
      };
      if (modal === "edit" && form.id) {
        await supabase.from("properties").update({
          ...payload, updated_at: new Date().toISOString(),
        }).eq("id", form.id);
        notify("✓ Modifié");
      } else {
        await supabase.from("properties").insert(payload);
        notify("✓ Bien créé");
      }
      setModal(null); setForm({}); load();
    } catch (e: any) { setErr(e.message); }
  };

  const del = async (id: string, name: string) => {
    const linkedLoans = loans.filter(l => l.property_id === id);
    if (linkedLoans.length > 0) {
      if (!confirm(`"${name}" a ${linkedLoans.length} prêt(s) lié(s). Les prêts seront conservés mais dissociés. Continuer ?`)) return;
    } else {
      if (!confirm(`Supprimer "${name}" ?`)) return;
    }
    await supabase.from("properties").delete().eq("id", id);
    notify("✓ Supprimé"); load();
  };

  // Valeur nette par bien : current_value × ownership% − dettes liées
  const rowsWithNet = useMemo(() => {
    return properties.map(p => {
      const propLoans = loans.filter(l => l.property_id === p.id);
      const totalDebt = propLoans.reduce((s, l) => s + Number(l.current_balance || 0), 0);
      const ownedValue = Number(p.current_value || 0) * (Number(p.ownership_pct || 100) / 100);
      const netValue = ownedValue - totalDebt;
      const gain = ownedValue - Number(p.purchase_price || 0) * (Number(p.ownership_pct || 100) / 100);
      return { property: p, loans: propLoans, totalDebt, ownedValue, netValue, gain };
    });
  }, [properties, loans]);

  // Agrégations par devise
  const totals = useMemo(() => {
    const byCcy: Record<string, { gross: number; debt: number; net: number }> = {};
    for (const r of rowsWithNet) {
      const ccy = r.property.currency;
      if (!byCcy[ccy]) byCcy[ccy] = { gross: 0, debt: 0, net: 0 };
      byCcy[ccy].gross += r.ownedValue;
      byCcy[ccy].debt += r.totalDebt;
      byCcy[ccy].net += r.netValue;
    }
    return byCcy;
  }, [rowsWithNet]);

  if (loading) {
    return <div className="flex items-center justify-center py-20"><span className="font-mono text-dim text-sm">loading...</span></div>;
  }

  return (
    <div>
      {toast && <div className="fixed top-3 right-3 z-50 bg-up text-white py-2 px-4 rounded-md text-xs font-mono animate-fade-up shadow-lg shadow-black/40">{toast}</div>}

      <div className="border-b border-border py-2 px-5 flex items-center justify-between">
        <span className="text-[10px] text-dim uppercase tracking-widest">Immobilier</span>
        <div className="flex gap-4 text-[11px] font-mono">
          {Object.entries(totals).map(([ccy, t]) => (
            <span key={ccy} className="text-muted">
              Net : <span className="text-bright font-semibold">{fmt(t.net, 0)}</span> {ccy}
              {t.debt > 0 && <span className="text-dim"> (dont dette {fmt(t.debt, 0)})</span>}
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
          <span className="text-bright text-sm font-semibold">{properties.length} bien{properties.length > 1 ? "s" : ""} immobilier{properties.length > 1 ? "s" : ""}</span>
          <button onClick={() => { setForm({ type: "residence", currency: "EUR", ownership_pct: 100 }); setModal("new"); }}
            className="py-[5px] px-[10px] bg-accent text-white rounded-md text-[11px] font-medium inline-flex items-center gap-1.5">
            <Plus size={11} /> Nouveau bien
          </button>
        </div>

        {properties.length === 0 ? (
          <div className="bg-card border border-border rounded-lg py-16 text-center">
            <Home size={28} className="mx-auto text-dim mb-3" />
            <div className="text-muted text-[12px] mb-1">Aucun bien immobilier</div>
            <div className="text-dim text-[10px] font-mono">Ajoute ta résidence, un locatif, un terrain...</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {rowsWithNet.map(({ property: p, loans: propLoans, totalDebt, ownedValue, netValue, gain }) => {
              const Ico = TYPE_ICONS[p.type] || Home;
              const gainPct = Number(p.purchase_price) > 0
                ? (gain / (Number(p.purchase_price) * p.ownership_pct / 100)) * 100
                : 0;
              const ownerSuffix = p.ownership_pct < 100 ? ` · ${p.ownership_pct}%` : "";
              return (
                <div key={p.id} className="bg-card border border-border rounded-lg p-4 hover:border-dim transition-colors">
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <Ico size={14} color={C.accent} />
                      <div className="min-w-0">
                        <div className="text-bright text-[14px] font-semibold truncate">{p.name}</div>
                        <div className="text-dim text-[10px] font-mono">
                          {TYPE_LABELS[p.type]}{ownerSuffix}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0 ml-2">
                      <button onClick={() => { setForm(p); setModal("edit"); }} className="text-dim hover:text-accent p-0.5"><Pencil size={11} /></button>
                      <button onClick={() => del(p.id, p.name)} className="text-dim hover:text-down p-0.5"><Trash2 size={11} /></button>
                    </div>
                  </div>

                  {p.address && <div className="text-dim text-[10px] italic mb-2">{p.address}</div>}

                  {/* Valeurs */}
                  <div className="space-y-1.5 text-[11px] font-mono">
                    <div className="flex justify-between">
                      <span className="text-muted">Valeur actuelle</span>
                      <span className="text-bright">{fmt(ownedValue, 0)} {p.currency}</span>
                    </div>
                    {totalDebt > 0 && (
                      <div className="flex justify-between">
                        <span className="text-muted">Dette restante</span>
                        <span className="text-down">−{fmt(totalDebt, 0)} {p.currency}</span>
                      </div>
                    )}
                    <div className="flex justify-between pt-1.5 border-t border-border/40">
                      <span className="text-muted font-semibold">Valeur nette</span>
                      <span className="text-bright text-[13px] font-bold">{fmt(netValue, 0)} {p.currency}</span>
                    </div>
                  </div>

                  {/* Perf achat */}
                  {Number(p.purchase_price) > 0 && (
                    <div className="mt-3 pt-2 border-t border-border/30 flex justify-between items-center text-[10px] font-mono">
                      <span className="text-dim">Achat : {fmt(Number(p.purchase_price) * p.ownership_pct / 100, 0)} {p.currency}
                        {p.purchase_date && <span className="ml-1">({p.purchase_date.slice(0, 7)})</span>}
                      </span>
                      <span style={{ color: gain >= 0 ? C.green : C.red }}>
                        {gain >= 0 ? "+" : ""}{fmt(gain, 0)} {p.currency} ({gainPct >= 0 ? "+" : ""}{fmt(gainPct, 1)}%)
                      </span>
                    </div>
                  )}

                  {/* Prêts liés */}
                  {propLoans.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-border/30">
                      <div className="text-[9px] text-dim uppercase tracking-wider mb-1">Prêts liés</div>
                      {propLoans.map(l => (
                        <div key={l.id} className="text-[10px] font-mono flex justify-between">
                          <span className="text-muted truncate">{l.name}</span>
                          <span className="text-down ml-2 shrink-0">{fmt(l.current_balance, 0)} {l.currency}</span>
                        </div>
                      ))}
                    </div>
                  )}
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
                {modal === "new" ? "Nouveau bien immobilier" : "Modifier le bien"}
              </h3>
              <button onClick={() => setModal(null)} className="text-muted hover:text-bright"><X size={16} /></button>
            </div>

            <div className="mb-3">
              <label className="block text-muted text-[10px] mb-1 uppercase tracking-wider">Nom*</label>
              <input value={form.name || ""} onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="Appart Paris 11e"
                className="w-full py-[7px] px-[10px] bg-bg border border-border rounded-md text-bright text-[13px] outline-none font-mono placeholder:text-dim" />
            </div>

            <div className="flex gap-2">
              <div className="flex-1 mb-3">
                <label className="block text-muted text-[10px] mb-1 uppercase tracking-wider">Type</label>
                <select value={form.type || "residence"} onChange={e => setForm({ ...form, type: e.target.value })}
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

            <div className="mb-3">
              <label className="block text-muted text-[10px] mb-1 uppercase tracking-wider">Adresse (optionnel)</label>
              <input value={form.address || ""} onChange={e => setForm({ ...form, address: e.target.value })}
                className="w-full py-[7px] px-[10px] bg-bg border border-border rounded-md text-bright text-[13px] outline-none font-mono placeholder:text-dim" />
            </div>

            <div className="flex gap-2">
              <div className="flex-1 mb-3">
                <label className="block text-muted text-[10px] mb-1 uppercase tracking-wider">Prix d&apos;achat</label>
                <input type="number" step=".01" value={form.purchase_price ?? ""} onChange={e => setForm({ ...form, purchase_price: e.target.value })}
                  placeholder="250000"
                  className="w-full py-[7px] px-[10px] bg-bg border border-border rounded-md text-bright text-[13px] outline-none font-mono placeholder:text-dim" />
              </div>
              <div className="flex-1 mb-3">
                <label className="block text-muted text-[10px] mb-1 uppercase tracking-wider">Valeur actuelle*</label>
                <input type="number" step=".01" value={form.current_value ?? ""} onChange={e => setForm({ ...form, current_value: e.target.value })}
                  placeholder="320000"
                  className="w-full py-[7px] px-[10px] bg-bg border border-border rounded-md text-bright text-[13px] outline-none font-mono placeholder:text-dim" />
              </div>
            </div>

            <div className="flex gap-2">
              <div className="flex-1 mb-3">
                <label className="block text-muted text-[10px] mb-1 uppercase tracking-wider">Date d&apos;achat</label>
                <input type="date" value={form.purchase_date || ""} onChange={e => setForm({ ...form, purchase_date: e.target.value })}
                  className="w-full py-[7px] px-[10px] bg-bg border border-border rounded-md text-bright text-[13px] outline-none font-mono" />
              </div>
              <div className="w-[110px] mb-3">
                <label className="block text-muted text-[10px] mb-1 uppercase tracking-wider">% détenu</label>
                <input type="number" step="1" min="0" max="100" value={form.ownership_pct ?? 100}
                  onChange={e => setForm({ ...form, ownership_pct: e.target.value })}
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