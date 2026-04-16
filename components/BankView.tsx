"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import type { BankAccount, BankAccountType, Currency } from "@/lib/types";
import { Plus, Pencil, Trash2, X, Landmark, PiggyBank, TrendingUp, Wallet } from "lucide-react";

const fmt = (n: number | null | undefined, d = 2) =>
  n == null ? "—" : Number(n).toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });

const C = {
  accent: "#58a6ff", green: "#3fb950", red: "#f85149",
  border: "#1b2332", dim: "#484f58", muted: "#6e7681", bright: "#e6edf3",
};

const TYPE_LABELS: Record<BankAccountType, string> = {
  checking: "Compte courant",
  savings: "Épargne",
  livret_a: "Livret A",
  ldds: "LDDS",
  lep: "LEP",
  pel: "PEL",
  cel: "CEL",
  assurance_vie: "Assurance-vie",
  other: "Autre",
};

const TYPE_ICONS: Record<BankAccountType, any> = {
  checking: Wallet, savings: PiggyBank, livret_a: PiggyBank, ldds: PiggyBank,
  lep: PiggyBank, pel: PiggyBank, cel: PiggyBank, assurance_vie: TrendingUp, other: Landmark,
};

const CURRENCIES: Currency[] = ["EUR", "USD", "CAD", "AUD", "GBP"];

export default function BankView({ personId }: { personId: string }) {
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [modal, setModal] = useState<"new" | "edit" | null>(null);
  const [form, setForm] = useState<any>({});

  const notify = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2000); };

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("bank_accounts")
      .select("*").eq("person_id", personId).order("type").order("name");
    if (error) setErr(error.message);
    setAccounts((data || []) as BankAccount[]);
    setLoading(false);
  }, [personId]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    try {
      const payload = {
        person_id: personId,
        name: form.name.trim(),
        type: form.type || "checking",
        bank_name: form.bank_name?.trim() || null,
        currency: form.currency || "EUR",
        balance: Number(form.balance || 0),
        interest_rate: form.interest_rate ? Number(form.interest_rate) : null,
        notes: form.notes?.trim() || null,
      };
      if (modal === "edit" && form.id) {
        await supabase.from("bank_accounts").update({
          ...payload, updated_at: new Date().toISOString(),
        }).eq("id", form.id);
        notify("✓ Modifié");
      } else {
        await supabase.from("bank_accounts").insert(payload);
        notify("✓ Compte créé");
      }
      setModal(null); setForm({}); load();
    } catch (e: any) { setErr(e.message); }
  };

  const del = async (id: string, name: string) => {
    if (!confirm(`Supprimer "${name}" ?`)) return;
    await supabase.from("bank_accounts").delete().eq("id", id);
    notify("✓ Supprimé"); load();
  };

  // Agrégations par devise
  const byCurrency = useMemo(() => {
    const m: Record<string, number> = {};
    for (const a of accounts) {
      m[a.currency] = (m[a.currency] || 0) + Number(a.balance || 0);
    }
    return m;
  }, [accounts]);

  // Groupé par type
  const grouped = useMemo(() => {
    const g: Record<string, BankAccount[]> = {};
    for (const a of accounts) {
      if (!g[a.type]) g[a.type] = [];
      g[a.type].push(a);
    }
    return g;
  }, [accounts]);

  if (loading) {
    return <div className="flex items-center justify-center py-20"><span className="font-mono text-dim text-sm">loading...</span></div>;
  }

  return (
    <div>
      {toast && <div className="fixed top-3 right-3 z-50 bg-up text-white py-2 px-4 rounded-md text-xs font-mono animate-fade-up shadow-lg shadow-black/40">{toast}</div>}

      <div className="border-b border-border py-2 px-5 flex items-center justify-between">
        <span className="text-[10px] text-dim uppercase tracking-widest">Banque</span>
        <div className="flex gap-3 text-[11px] font-mono">
          {Object.entries(byCurrency).map(([ccy, total]) => (
            <span key={ccy} className="text-muted">
              <span className="text-bright font-semibold">{fmt(total, 0)}</span> {ccy}
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
          <span className="text-bright text-sm font-semibold">{accounts.length} compte{accounts.length > 1 ? "s" : ""} bancaire{accounts.length > 1 ? "s" : ""}</span>
          <button onClick={() => { setForm({ type: "checking", currency: "EUR", balance: 0 }); setModal("new"); }}
            className="py-[5px] px-[10px] bg-accent text-white rounded-md text-[11px] font-medium inline-flex items-center gap-1.5">
            <Plus size={11} /> Nouveau compte
          </button>
        </div>

        {accounts.length === 0 ? (
          <div className="bg-card border border-border rounded-lg py-16 text-center">
            <Landmark size={28} className="mx-auto text-dim mb-3" />
            <div className="text-muted text-[12px] mb-1">Aucun compte bancaire</div>
            <div className="text-dim text-[10px] font-mono">Clique sur &quot;Nouveau compte&quot; pour commencer</div>
          </div>
        ) : (
          <div className="space-y-5">
            {Object.entries(grouped).map(([type, accs]) => {
              const Ico = TYPE_ICONS[type as BankAccountType] || Landmark;
              const subtotal = accs.reduce((s, a) => s + Number(a.balance || 0), 0);
              const sameCcy = accs.every(a => a.currency === accs[0].currency);
              return (
                <div key={type}>
                  <div className="flex items-center gap-2 mb-2 px-1">
                    <Ico size={13} color={C.muted} />
                    <span className="text-muted text-[11px] font-semibold uppercase tracking-wider">{TYPE_LABELS[type as BankAccountType]}</span>
                    <span className="text-dim text-[10px] font-mono">({accs.length})</span>
                    {sameCcy && (
                      <span className="text-dim text-[10px] font-mono ml-auto">
                        = <span className="text-bright font-semibold">{fmt(subtotal, 0)}</span> {accs[0].currency}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                    {accs.map(a => (
                      <div key={a.id} className="bg-card border border-border rounded-lg p-3.5 hover:border-dim transition-colors">
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex-1 min-w-0">
                            <div className="text-bright text-[13px] font-semibold truncate">{a.name}</div>
                            {a.bank_name && <div className="text-dim text-[10px] font-mono truncate">{a.bank_name}</div>}
                          </div>
                          <div className="flex gap-1 shrink-0 ml-2">
                            <button onClick={() => { setForm(a); setModal("edit"); }} className="text-dim hover:text-accent p-0.5"><Pencil size={11} /></button>
                            <button onClick={() => del(a.id, a.name)} className="text-dim hover:text-down p-0.5"><Trash2 size={11} /></button>
                          </div>
                        </div>
                        <div className="text-[19px] font-bold font-mono text-bright tracking-tight">
                          {fmt(a.balance, 0)} <span className="text-[12px] text-muted font-normal">{a.currency}</span>
                        </div>
                        {a.interest_rate != null && (
                          <div className="text-[10px] text-muted font-mono mt-1">
                            Taux : {fmt(a.interest_rate, 2)}%
                          </div>
                        )}
                        {a.notes && <div className="text-[10px] text-dim mt-1.5 italic truncate">{a.notes}</div>}
                      </div>
                    ))}
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
          <div onClick={e => e.stopPropagation()} className="bg-card border border-border rounded-xl p-6 w-[92%] max-w-[460px] max-h-[85vh] overflow-auto">
            <div className="flex justify-between items-center mb-5">
              <h3 className="text-bright text-[15px] font-semibold">
                {modal === "new" ? "Nouveau compte bancaire" : "Modifier le compte"}
              </h3>
              <button onClick={() => setModal(null)} className="text-muted hover:text-bright"><X size={16} /></button>
            </div>

            <div className="mb-3">
              <label className="block text-muted text-[10px] mb-1 uppercase tracking-wider">Nom*</label>
              <input value={form.name || ""} onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="Livret A, Compte courant BNP..."
                className="w-full py-[7px] px-[10px] bg-bg border border-border rounded-md text-bright text-[13px] outline-none font-mono placeholder:text-dim" />
            </div>

            <div className="flex gap-2">
              <div className="flex-1 mb-3">
                <label className="block text-muted text-[10px] mb-1 uppercase tracking-wider">Type</label>
                <select value={form.type || "checking"} onChange={e => setForm({ ...form, type: e.target.value })}
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
              <label className="block text-muted text-[10px] mb-1 uppercase tracking-wider">Banque (optionnel)</label>
              <input value={form.bank_name || ""} onChange={e => setForm({ ...form, bank_name: e.target.value })}
                placeholder="BNP, Boursorama, Revolut..."
                className="w-full py-[7px] px-[10px] bg-bg border border-border rounded-md text-bright text-[13px] outline-none font-mono placeholder:text-dim" />
            </div>

            <div className="flex gap-2">
              <div className="flex-1 mb-3">
                <label className="block text-muted text-[10px] mb-1 uppercase tracking-wider">Solde*</label>
                <input type="number" step=".01" value={form.balance ?? ""} onChange={e => setForm({ ...form, balance: e.target.value })}
                  placeholder="1000"
                  className="w-full py-[7px] px-[10px] bg-bg border border-border rounded-md text-bright text-[13px] outline-none font-mono placeholder:text-dim" />
              </div>
              <div className="flex-1 mb-3">
                <label className="block text-muted text-[10px] mb-1 uppercase tracking-wider">Taux % (opt.)</label>
                <input type="number" step=".01" value={form.interest_rate ?? ""} onChange={e => setForm({ ...form, interest_rate: e.target.value })}
                  placeholder="3.0"
                  className="w-full py-[7px] px-[10px] bg-bg border border-border rounded-md text-bright text-[13px] outline-none font-mono placeholder:text-dim" />
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