"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import type { Person } from "@/lib/types";
import { Eye, EyeOff, Shield, AlertCircle } from "lucide-react";

type PrivacyRow = {
  id?: string;
  person_id: string;
  is_public: boolean;
  show_networth_total: boolean;
  show_categories: boolean;
  show_stocks_detail: boolean;
  show_bank: boolean;
  show_real_estate: boolean;
  show_loans: boolean;
  show_goals: boolean;
  show_dividends: boolean;
  show_history_graph: boolean;
};

const DEFAULT_PRIVACY = (personId: string): PrivacyRow => ({
  person_id: personId,
  is_public: false,
  show_networth_total: true,
  show_categories: false,
  show_stocks_detail: false,
  show_bank: false,
  show_real_estate: false,
  show_loans: false,
  show_goals: false,
  show_dividends: false,
  show_history_graph: true,
});

const FIELDS: { key: keyof PrivacyRow; label: string; hint: string }[] = [
  { key: "show_networth_total", label: "Net Worth total",     hint: "Le gros chiffre en EUR" },
  { key: "show_history_graph",  label: "Graph d'évolution",   hint: "Courbe historique du NW" },
  { key: "show_categories",     label: "Breakdown catégories", hint: "Montants par Actions/Banque/Immo/Dettes" },
  { key: "show_stocks_detail",  label: "Stocks détaillés",    hint: "Positions, tickers, trades" },
  { key: "show_bank",           label: "Comptes bancaires",   hint: "Détail des soldes par banque" },
  { key: "show_real_estate",    label: "Biens immobiliers",   hint: "Biens, valeur, adresses" },
  { key: "show_loans",          label: "Dettes / prêts",      hint: "Capital restant dû" },
  { key: "show_goals",          label: "Objectifs",           hint: "Tes goals et leur progression" },
  { key: "show_dividends",      label: "Dividendes",          hint: "Montants reçus, historique" },
];

export default function PrivacyView() {
  const [loading, setLoading] = useState(true);
  const [people, setPeople] = useState<Person[]>([]);
  const [privacyByPerson, setPrivacyByPerson] = useState<Record<string, PrivacyRow>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const notify = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2000); };

  const load = useCallback(async () => {
    setLoading(true);
    // Récupère toutes les people que j'ai le droit de voir (RLS filtre automatiquement)
    const [pR, prR] = await Promise.all([
      supabase.from("people").select("*").order("name"),
      supabase.from("people_privacy").select("*"),
    ]);
    const peopleData = (pR.data || []) as Person[];
    setPeople(peopleData);

    const byId: Record<string, PrivacyRow> = {};
    for (const p of peopleData) {
      byId[p.id] = DEFAULT_PRIVACY(p.id);
    }
    for (const row of (prR.data || [])) {
      byId[row.person_id] = { ...byId[row.person_id], ...row };
    }
    setPrivacyByPerson(byId);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const update = async (personId: string, changes: Partial<PrivacyRow>) => {
    const current = privacyByPerson[personId];
    const next: PrivacyRow = { ...current, ...changes };
    setPrivacyByPerson(prev => ({ ...prev, [personId]: next }));
    setSaving(personId);

    try {
      // Upsert — RLS s'assure qu'on peut modifier seulement ses own people
      const { error } = await supabase.from("people_privacy").upsert({
        person_id: personId,
        is_public: next.is_public,
        show_networth_total: next.show_networth_total,
        show_categories: next.show_categories,
        show_stocks_detail: next.show_stocks_detail,
        show_bank: next.show_bank,
        show_real_estate: next.show_real_estate,
        show_loans: next.show_loans,
        show_goals: next.show_goals,
        show_dividends: next.show_dividends,
        show_history_graph: next.show_history_graph,
      }, { onConflict: "person_id" });
      if (error) throw error;
      notify("✓ Sauvegardé");
    } catch (e: any) {
      notify("❌ " + e.message);
      setPrivacyByPerson(prev => ({ ...prev, [personId]: current })); // rollback
    }
    setSaving(null);
  };

  if (loading) {
    return <div className="flex items-center justify-center py-24"><span className="font-mono text-[var(--text-3)] text-sm">loading...</span></div>;
  }

  return (
    <div className="px-5 py-6 max-w-[900px] mx-auto">
      {toast && (
        <div className="fixed top-3 right-3 z-50 bg-[var(--green)] text-white py-2 px-4 rounded-md text-xs font-mono animate-fade-up shadow-lg">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <Shield size={18} className="text-[var(--accent)]" />
          <h1 className="text-[var(--text-1)] text-xl font-semibold">Confidentialité</h1>
        </div>
        <p className="text-[var(--text-3)] text-sm">
          Choisis ce que les autres utilisateurs peuvent voir de toi. Par défaut, tout est privé.
        </p>
      </div>

      {/* Info box */}
      <div className="bg-[var(--accent-bg)] border border-[var(--accent)]/30 rounded-lg p-4 mb-6 flex gap-3">
        <AlertCircle size={14} className="text-[var(--accent)] shrink-0 mt-0.5" />
        <div className="text-[11px] text-[var(--text-2)] leading-relaxed">
          <div className="font-semibold text-[var(--text-1)] mb-1">Comment ça marche</div>
          <div>• Chaque <span className="font-mono text-[var(--text-1)]">personne</span> a ses propres règles de confidentialité</div>
          <div>• Le toggle <span className="font-mono">« Public »</span> en haut est le switch maître — désactivé, rien n&apos;est partagé</div>
          <div>• Si activé, tu choisis précisément ce qui est visible aux autres</div>
          <div>• Tu restes toujours 100 % visible pour toi-même (évidemment)</div>
        </div>
      </div>

      {people.length === 0 ? (
        <div className="card-static py-12 text-center">
          <div className="text-[var(--text-3)] text-sm">Aucune personne à configurer</div>
        </div>
      ) : (
        <div className="space-y-4">
          {people.map(p => {
            const privacy = privacyByPerson[p.id] || DEFAULT_PRIVACY(p.id);
            const isSaving = saving === p.id;
            const sharedCount = FIELDS.filter(f => privacy[f.key]).length;

            return (
              <div key={p.id} className="card-static p-5">
                {/* Header avec toggle maître */}
                <div className="flex items-start justify-between mb-4 pb-4 border-b border-[var(--border)]">
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center
                      ${privacy.is_public ? "bg-[var(--green-bg)]" : "bg-[var(--bg-overlay)]"}`}>
                      {privacy.is_public
                        ? <Eye size={15} className="text-[var(--green)]" />
                        : <EyeOff size={15} className="text-[var(--text-3)]" />}
                    </div>
                    <div>
                      <div className="text-[var(--text-1)] text-base font-semibold">{p.name}</div>
                      <div className="text-[var(--text-3)] text-[11px] font-mono">
                        {privacy.is_public
                          ? `Public · ${sharedCount} champ${sharedCount > 1 ? "s" : ""} partagé${sharedCount > 1 ? "s" : ""}`
                          : "Privé — invisible pour les autres"}
                      </div>
                    </div>
                  </div>

                  <ToggleSwitch
                    checked={privacy.is_public}
                    onChange={v => update(p.id, { is_public: v })}
                    disabled={isSaving}
                    label="Public"
                  />
                </div>

                {/* Détails */}
                <div className={`space-y-1 transition-opacity ${privacy.is_public ? "" : "opacity-40 pointer-events-none"}`}>
                  <div className="text-[10px] text-[var(--text-3)] uppercase tracking-wider mb-2">
                    Que rendre visible ?
                  </div>
                  {FIELDS.map(f => (
                    <label key={f.key}
                      className="flex items-center justify-between py-2.5 px-3 rounded-md hover:bg-[var(--bg-overlay)] cursor-pointer transition-colors">
                      <div className="flex-1 min-w-0">
                        <div className="text-[var(--text-1)] text-sm font-medium">{f.label}</div>
                        <div className="text-[var(--text-3)] text-[11px]">{f.hint}</div>
                      </div>
                      <ToggleSwitch
                        checked={Boolean(privacy[f.key])}
                        onChange={v => update(p.id, { [f.key]: v } as any)}
                        disabled={isSaving || !privacy.is_public}
                        small
                      />
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── Toggle switch ─── */
function ToggleSwitch({
  checked, onChange, disabled, small, label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  small?: boolean;
  label?: string;
}) {
  const w = small ? 36 : 44;
  const h = small ? 20 : 24;
  const k = small ? 14 : 18;
  const pad = (h - k) / 2;

  return (
    <div className="flex items-center gap-2 shrink-0">
      {label && (
        <span className={`text-[11px] font-medium ${checked ? "text-[var(--text-1)]" : "text-[var(--text-3)]"}`}>
          {label}
        </span>
      )}
      <button
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative rounded-full transition-all ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
        style={{
          width: w, height: h,
          background: checked ? "var(--accent)" : "var(--bg-overlay)",
          border: "1px solid",
          borderColor: checked ? "var(--accent)" : "var(--border)",
        }}
      >
        <span
          className="absolute rounded-full transition-all"
          style={{
            width: k, height: k,
            top: pad - 1, left: checked ? w - k - pad - 1 : pad - 1,
            background: checked ? "white" : "var(--text-3)",
          }}
        />
      </button>
    </div>
  );
}