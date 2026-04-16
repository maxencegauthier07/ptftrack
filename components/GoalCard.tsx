"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import type { Goal, VelocityWindow } from "@/lib/types";
import { Target, Pencil, X, Check, TrendingUp, Calendar, Sparkles, Plus, ChevronDown, ChevronUp } from "lucide-react";

const fmt = (n: number | null | undefined, d = 0) =>
  n == null ? "—" : Number(n).toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });

const daysBetween = (a: string, b: string) => {
  const dA = new Date(a); const dB = new Date(b);
  return Math.round((dB.getTime() - dA.getTime()) / 86400000);
};

const todayStr = () => new Date().toISOString().slice(0, 10);

// Référence figée pour la progression (coïncide avec le backfill)
const REF_DATE = "2025-12-31";

type NwSnapshot = { date: string; net: number };

type Props = {
  personId: string;
  currentNet: number;
  snapshots: NwSnapshot[];
  onNotify?: (m: string) => void;
};

const VELOCITY_LABELS: Record<VelocityWindow, string> = {
  "30d":       "30 jours",
  "90d":       "3 mois",
  "180d":      "6 mois",
  "ytd":       "YTD",
  "since_ref": "Depuis 31/12/25",
};

export default function GoalCard({ personId, currentNet, snapshots, onNotify }: Props) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<"new" | "edit" | null>(null);
  const [editForm, setEditForm] = useState<any>({});

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("goals")
      .select("*").eq("person_id", personId).eq("active", true)
      .order("sort_order").order("target_amount");
    setGoals((data || []) as Goal[]);
    setLoading(false);
  }, [personId]);

  useEffect(() => { load(); }, [load]);

  // Détection "atteint" pour chaque goal
  useEffect(() => {
    (async () => {
      for (const g of goals) {
        if (!g.achieved_at && currentNet >= Number(g.target_amount)) {
          await supabase.from("goals").update({
            achieved_at: new Date().toISOString(),
          }).eq("id", g.id);
          onNotify?.(`🎉 "${g.name}" atteint !`);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goals, currentNet]);

  const openNew = () => {
    setEditForm({
      name: "",
      target_amount: "",
      target_date: "",
      velocity_window: "30d" as VelocityWindow,
    });
    setModal("new");
  };

  const openEdit = (g: Goal) => {
    setEditForm({
      id: g.id,
      name: g.name,
      target_amount: String(g.target_amount),
      target_date: g.target_date || "",
      velocity_window: g.velocity_window || "30d",
    });
    setModal("edit");
  };

  const save = async () => {
    const target = Number(editForm.target_amount);
    if (!target || target <= 0) return;

    try {
      // Calcul du start_amount depuis le snapshot fin 2025 si dispo
      const refSnapshot = snapshots.find(s => s.date <= REF_DATE && s.date >= "2025-12-20")
        || snapshots[0];
      const startAmount = refSnapshot ? Number(refSnapshot.net) : currentNet;

      if (modal === "edit" && editForm.id) {
        await supabase.from("goals").update({
          name: editForm.name || "Objectif",
          target_amount: target,
          target_date: editForm.target_date || null,
          velocity_window: editForm.velocity_window,
          updated_at: new Date().toISOString(),
        }).eq("id", editForm.id);
        onNotify?.("✓ Objectif modifié");
      } else {
        const nextOrder = goals.length > 0 ? Math.max(...goals.map(g => g.sort_order || 0)) + 1 : 0;
        await supabase.from("goals").insert({
          person_id: personId,
          name: editForm.name || "Objectif",
          target_amount: target,
          target_date: editForm.target_date || null,
          start_amount: startAmount,
          start_date: REF_DATE,
          velocity_window: editForm.velocity_window,
          active: true,
          sort_order: nextOrder,
        });
        onNotify?.("✓ Objectif créé");
      }
      setModal(null); load();
    } catch (e: any) {
      onNotify?.(e.message);
    }
  };

  const archive = async (g: Goal) => {
    if (!confirm(`Archiver "${g.name}" ?`)) return;
    await supabase.from("goals").update({ active: false }).eq("id", g.id);
    onNotify?.("✓ Objectif archivé");
    load();
  };

  const reorder = async (g: Goal, dir: "up" | "down") => {
    const sorted = [...goals].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const idx = sorted.findIndex(x => x.id === g.id);
    const swapIdx = dir === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    const other = sorted[swapIdx];
    await Promise.all([
      supabase.from("goals").update({ sort_order: other.sort_order }).eq("id", g.id),
      supabase.from("goals").update({ sort_order: g.sort_order }).eq("id", other.id),
    ]);
    load();
  };

  if (loading) return null;

  // Pas de goal : CTA unique
  if (goals.length === 0) {
    return (
      <>
        <div className="card-static p-5 mb-6 text-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[var(--accent-bg)] flex items-center justify-center">
              <Target size={18} className="text-[var(--accent)]" />
            </div>
            <div>
              <div className="text-[var(--text-1)] text-sm font-semibold mb-1">Fixe-toi des objectifs</div>
              <div className="text-[var(--text-3)] text-xs">Court terme, long terme, FIRE... plusieurs objectifs en parallèle</div>
            </div>
            <button onClick={openNew} className="btn btn-primary">
              <Plus size={12} /> Nouvel objectif
            </button>
          </div>
        </div>

        {modal && <GoalModal form={editForm} setForm={setEditForm}
          onClose={() => setModal(null)} onSave={save}
          currentNet={currentNet} isEdit={false} />}
      </>
    );
  }

  // Multi-goals affichage
  return (
    <>
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Target size={13} className="text-[var(--accent)]" />
            <span className="text-[var(--text-1)] text-sm font-semibold">Objectifs</span>
            <span className="text-[var(--text-3)] text-[10px] font-mono">({goals.length})</span>
          </div>
          <button onClick={openNew}
            className="text-[var(--text-3)] hover:text-[var(--text-1)] inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded hover:bg-[var(--bg-overlay)]">
            <Plus size={11} /> Nouveau
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {goals.map((g, idx) => (
            <SingleGoal
              key={g.id}
              goal={g}
              currentNet={currentNet}
              snapshots={snapshots}
              canMoveUp={idx > 0}
              canMoveDown={idx < goals.length - 1}
              onEdit={() => openEdit(g)}
              onArchive={() => archive(g)}
              onMoveUp={() => reorder(g, "up")}
              onMoveDown={() => reorder(g, "down")}
            />
          ))}
        </div>
      </div>

      {modal && <GoalModal form={editForm} setForm={setEditForm}
        onClose={() => setModal(null)} onSave={save}
        currentNet={currentNet} isEdit={modal === "edit"} />}
    </>
  );
}

/* ─────────────────────────────────────────────────────────
   CARD POUR UN OBJECTIF
   ───────────────────────────────────────────────────────── */

function SingleGoal({
  goal, currentNet, snapshots,
  canMoveUp, canMoveDown,
  onEdit, onArchive, onMoveUp, onMoveDown,
}: {
  goal: Goal; currentNet: number; snapshots: NwSnapshot[];
  canMoveUp: boolean; canMoveDown: boolean;
  onEdit: () => void; onArchive: () => void;
  onMoveUp: () => void; onMoveDown: () => void;
}) {
  const target = Number(goal.target_amount);
  const startAmount = Number(goal.start_amount ?? 0);
  const startDate = goal.start_date || REF_DATE;
  const achieved = !!goal.achieved_at;

  // Progression absolue depuis la ref (fin 2025)
  const progressAbs = currentNet - startAmount;
  const targetAbs = target - startAmount;
  const progressPct = targetAbs > 0
    ? Math.max(0, Math.min(100, (progressAbs / targetAbs) * 100))
    : 0;

  // ★ Taux de croissance mensuel COMPOSÉ (pas linéaire en €)
  //   Formule : (NW_fin / NW_début)^(1/nb_mois) - 1
  const monthlyRate = useMemo(() => {
    if (snapshots.length < 2) return 0;

    let windowStart: string;
    const w = goal.velocity_window || "30d";
    if (w === "ytd") {
      const y = new Date().getFullYear();
      windowStart = `${y}-01-01`;
    } else if (w === "since_ref") {
      windowStart = REF_DATE;
    } else {
      const days = w === "30d" ? 30 : w === "90d" ? 90 : 180;
      const d = new Date();
      d.setDate(d.getDate() - days);
      windowStart = d.toISOString().slice(0, 10);
    }

    // Premier snapshot dans la fenêtre (ou fallback sur tous)
    let inWindow = snapshots.filter(s => s.date >= windowStart);
    if (inWindow.length < 2) inWindow = snapshots;
    if (inWindow.length < 2) return 0;

    const first = inWindow[0];
    const last = inWindow[inWindow.length - 1];
    const startVal = Number(first.net);
    const endVal = Number(last.net);
    // Si NW de départ <= 0 ou < 1 € -> compound impossible
    if (startVal <= 1) return 0;

    const days = Math.max(1, daysBetween(first.date, last.date));
    const months = days / 30.4375;   // jours moyens par mois
    const ratio = endVal / startVal;
    if (ratio <= 0) return 0;

    return Math.pow(ratio, 1 / months) - 1;
  }, [snapshots, goal.velocity_window]);

  // Projection — à taux composé
  const projection = useMemo(() => {
    const remaining = Math.max(0, target - currentNet);
    if (currentNet >= target) {
      return {
        projectedDate: goal.achieved_at?.slice(0, 10) || todayStr(),
        daysLeft: 0,
        monthlyEurEstimate: null as number | null,
      };
    }
    if (monthlyRate <= 0 || currentNet <= 0) {
      return { projectedDate: null, daysLeft: null, monthlyEurEstimate: null };
    }
    // NW(n) = NW_current × (1+r)^n = target
    // n = log(target/NW_current) / log(1+r)  en mois
    const monthsNeeded = Math.log(target / currentNet) / Math.log(1 + monthlyRate);
    if (!isFinite(monthsNeeded) || monthsNeeded <= 0) {
      return { projectedDate: null, daysLeft: null, monthlyEurEstimate: null };
    }
    const daysLeft = Math.ceil(monthsNeeded * 30.4375);
    const d = new Date();
    d.setDate(d.getDate() + daysLeft);

    // Gain estimé le mois prochain (pour affichage "+ X€/mois au rythme actuel")
    const monthlyEurEstimate = currentNet * monthlyRate;

    return {
      projectedDate: d.toISOString().slice(0, 10),
      daysLeft,
      monthlyEurEstimate,
    };
  }, [target, currentNet, monthlyRate, goal.achieved_at]);

  // On-track vs target_date
  const trackStatus = useMemo(() => {
    if (!goal.target_date || projection.daysLeft == null) return null;
    const targetDays = daysBetween(todayStr(), goal.target_date);
    const daysAhead = targetDays - projection.daysLeft;
    return { onTrack: daysAhead >= 0, daysAhead };
  }, [goal.target_date, projection.daysLeft]);

  const barColor = achieved
    ? "var(--green)"
    : trackStatus?.onTrack === false ? "var(--amber)" : "var(--accent)";

  return (
    <div className={`card-static p-4 ${achieved ? "ring-1 ring-[var(--green)]/30" : ""}`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0
            ${achieved ? "bg-[var(--green-bg)]" : "bg-[var(--accent-bg)]"}`}>
            {achieved ? <Sparkles size={13} className="text-[var(--green)]" /> : <Target size={13} className="text-[var(--accent)]" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[var(--text-1)] text-[13px] font-semibold truncate">{goal.name}</div>
            <div className="text-[var(--text-3)] text-[10px] font-mono">
              {fmt(target, 0)}€
              {goal.target_date && <span className="text-[var(--text-4)] ml-1.5">· {new Date(goal.target_date).toLocaleDateString("fr-FR", { month: "short", year: "2-digit" })}</span>}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          {canMoveUp && (
            <button onClick={onMoveUp} className="text-[var(--text-3)] hover:text-[var(--text-1)] p-1" title="Monter">
              <ChevronUp size={11} />
            </button>
          )}
          {canMoveDown && (
            <button onClick={onMoveDown} className="text-[var(--text-3)] hover:text-[var(--text-1)] p-1" title="Descendre">
              <ChevronDown size={11} />
            </button>
          )}
          <button onClick={onEdit} className="text-[var(--text-3)] hover:text-[var(--text-1)] p-1" title="Modifier">
            <Pencil size={11} />
          </button>
          <button onClick={onArchive} className="text-[var(--text-3)] hover:text-[var(--red)] p-1" title="Archiver">
            <X size={11} />
          </button>
        </div>
      </div>

      {/* Progress */}
      <div className="mb-2">
        <div className="flex justify-between items-baseline mb-1.5">
          <span className="text-[var(--text-1)] font-mono text-base font-semibold">
            {fmt(progressPct, 1)}%
          </span>
          {!achieved && (
            <span className="text-[var(--text-3)] text-[10px] font-mono">
              {fmt(currentNet, 0)} / {fmt(target, 0)}€
            </span>
          )}
        </div>
        <div className="h-1.5 bg-[var(--bg-overlay)] rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${Math.min(100, progressPct)}%`, background: barColor }}
          />
        </div>
        <div className="text-[9px] text-[var(--text-4)] font-mono mt-1">
          Depuis {startDate} · +{fmt(progressAbs, 0)}€
        </div>
      </div>

      {/* Infos secondaires */}
      {achieved ? (
        <div className="text-[var(--green)] text-[10px] font-mono flex items-center gap-1 mt-2">
          <Sparkles size={10} /> Atteint {goal.achieved_at && `le ${goal.achieved_at.slice(0, 10)}`}
        </div>
      ) : (
        <div className="space-y-1 text-[10px] font-mono mt-2">
          {monthlyRate > 0 ? (
            <>
              <div className="flex items-center gap-1.5 text-[var(--text-3)]">
                <TrendingUp size={10} />
                <span>
                  <span className="text-[var(--text-2)]">
                    +{fmt(monthlyRate * 100, 2)}%/mois
                  </span>
                  <span className="text-[var(--text-4)] ml-1">
                    · {fmt((Math.pow(1 + monthlyRate, 12) - 1) * 100, 1)}%/an
                  </span>
                </span>
              </div>
              {projection.monthlyEurEstimate && (
                <div className="flex items-center gap-1.5 text-[var(--text-4)] pl-[14px]">
                  <span>
                    ≈ +{fmt(projection.monthlyEurEstimate, 0)}€ ce mois au rythme actuel
                  </span>
                </div>
              )}
              {projection.projectedDate && (
                <div className="flex items-center gap-1.5 text-[var(--text-3)]">
                  <Calendar size={10} />
                  <span>
                    <span className="text-[var(--text-2)]">
                      {new Date(projection.projectedDate).toLocaleDateString("fr-FR", { month: "short", year: "numeric" })}
                    </span>
                    <span className="text-[var(--text-4)] ml-1">
                      ({projection.daysLeft} j · {VELOCITY_LABELS[goal.velocity_window || "30d"]})
                    </span>
                  </span>
                </div>
              )}
              {trackStatus && (
                <div className="flex items-center gap-1.5 font-medium"
                  style={{ color: trackStatus.onTrack ? "var(--green)" : "var(--amber)" }}>
                  <Target size={10} />
                  <span>
                    {trackStatus.onTrack
                      ? `${trackStatus.daysAhead}j d'avance`
                      : `${Math.abs(trackStatus.daysAhead)}j de retard`}
                  </span>
                </div>
              )}
            </>
          ) : (
            <div className="text-[var(--text-4)] italic">
              Pas de croissance positive sur {VELOCITY_LABELS[goal.velocity_window || "30d"]}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
   MODAL DE CRÉATION / ÉDITION
   ───────────────────────────────────────────────────────── */

function GoalModal({ form, setForm, onClose, onSave, currentNet, isEdit }: any) {
  const windows: { value: VelocityWindow; label: string; hint: string }[] = [
    { value: "30d",       label: "30 jours",      hint: "Rythme récent (réactif)" },
    { value: "90d",       label: "3 mois",        hint: "Tendance trimestrielle" },
    { value: "180d",      label: "6 mois",        hint: "Moyen terme lissé" },
    { value: "ytd",       label: "YTD",           hint: "Depuis le 1er janvier" },
    { value: "since_ref", label: "Depuis 31/12/25", hint: "Depuis la référence (fiable long terme)" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="card-static p-6 w-[92%] max-w-[460px] max-h-[85vh] overflow-auto animate-fade-up">
        <div className="flex justify-between items-center mb-5">
          <h3 className="text-[var(--text-1)] text-base font-semibold">
            {isEdit ? "Modifier l'objectif" : "Nouvel objectif"}
          </h3>
          <button onClick={onClose} className="text-[var(--text-2)] hover:text-[var(--text-1)]"><X size={16} /></button>
        </div>

        <div className="mb-3">
          <label className="block text-[var(--text-3)] text-[10px] mb-1 uppercase tracking-wider">Nom *</label>
          <input value={form.name || ""} onChange={e => setForm({ ...form, name: e.target.value })}
            placeholder="FIRE 2035, Objectif 200k fin d'année..." className="input" />
        </div>

        <div className="mb-3">
          <label className="block text-[var(--text-3)] text-[10px] mb-1 uppercase tracking-wider">Montant cible (EUR) *</label>
          <input type="number" step="1000" value={form.target_amount || ""}
            onChange={e => setForm({ ...form, target_amount: e.target.value })}
            placeholder="500000" className="input" />
          <div className="text-[10px] text-[var(--text-4)] mt-1 font-mono">
            Actuellement : {fmt(currentNet, 0)}€
          </div>
        </div>

        <div className="mb-3">
          <label className="block text-[var(--text-3)] text-[10px] mb-1 uppercase tracking-wider">
            Date cible (optionnel)
          </label>
          <input type="date" value={form.target_date || ""}
            onChange={e => setForm({ ...form, target_date: e.target.value })}
            className="input" />
        </div>

        <div className="mb-5">
          <label className="block text-[var(--text-3)] text-[10px] mb-1 uppercase tracking-wider">
            Rythme de référence
          </label>
          <div className="space-y-1">
            {windows.map(w => (
              <label key={w.value}
                className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors
                  ${form.velocity_window === w.value
                    ? "bg-[var(--accent-bg)] border border-[var(--accent)]/40"
                    : "hover:bg-[var(--bg-overlay)] border border-transparent"}`}>
                <input type="radio" name="velocity"
                  checked={form.velocity_window === w.value}
                  onChange={() => setForm({ ...form, velocity_window: w.value })}
                  className="accent-[var(--accent)]" />
                <div className="flex-1">
                  <div className="text-[12px] text-[var(--text-1)] font-medium">{w.label}</div>
                  <div className="text-[10px] text-[var(--text-3)]">{w.hint}</div>
                </div>
              </label>
            ))}
          </div>
          <div className="text-[10px] text-[var(--text-4)] mt-2">
            Utilisé pour calculer la projection de date d&apos;atteinte
          </div>
        </div>

        <div className="bg-[var(--bg-overlay)] rounded-md p-3 mb-4 text-[10px] text-[var(--text-3)] font-mono leading-relaxed">
          <span className="text-[var(--text-2)]">Référence de progression :</span> figée au 31/12/2025
          <br />
          <span className="text-[var(--text-4)]">La barre de progression = écart entre ton NW de fin 2025 et ta cible</span>
        </div>

        <button onClick={onSave} disabled={!form.target_amount || !form.name}
          className="btn btn-primary w-full justify-center">
          <Check size={12} /> {isEdit ? "Sauvegarder" : "Créer l'objectif"}
        </button>
      </div>
    </div>
  );
}