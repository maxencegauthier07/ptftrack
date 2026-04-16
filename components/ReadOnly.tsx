"use client";

import { usePerson } from "./PersonContext";
import { Eye, Lock } from "lucide-react";

/**
 * Wrapper qui entoure les vues "data" et applique le mode lecture seule si besoin.
 *
 * Stratégie :
 *  - Affiche un bandeau "Lecture seule — [Nom]" en haut
 *  - Ajoute une classe CSS qui désactive visuellement tous les boutons interactifs
 *    (sauf ceux qu'on veut laisser actifs comme les tabs)
 *  - Les inputs et selects sont passés en disabled via CSS pointer-events
 *  - Les onClick des boutons ne se déclenchent pas (pointer-events: none)
 */

export function ReadOnlyWrapper({ children }: { children: React.ReactNode }) {
  const { isEditable, person, privacy } = usePerson();

  if (isEditable) return <>{children}</>;

  return (
    <>
      <div className="sticky top-0 z-40 bg-[var(--amber)]/10 border-b border-[var(--amber)]/30 py-2 px-5 flex items-center justify-center gap-2 text-[11px]">
        <Eye size={12} className="text-[var(--amber)]" />
        <span className="text-[var(--amber)] font-medium">
          Mode lecture seule — tu consultes les données de {person?.name || "cette personne"}
        </span>
        {privacy?.is_public && (
          <span className="text-[var(--text-3)] font-mono">· Partagé par le propriétaire</span>
        )}
      </div>

      {/* ptf-ro = "ptftrack read-only" : cible les boutons d'édition en CSS global */}
      <div className="ptf-ro">
        {children}
      </div>
    </>
  );
}

/**
 * Gate qui cache un contenu si l'user n'a pas le droit de voir ce champ.
 * Exemple : <PrivacyGate field="show_bank"><BankView /></PrivacyGate>
 */
export function PrivacyGate({
  field, children, fallback,
}: {
  field: "show_networth_total" | "show_categories" | "show_stocks_detail"
       | "show_bank" | "show_real_estate" | "show_loans"
       | "show_goals" | "show_dividends" | "show_history_graph";
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { canSee, person, isEditable } = usePerson();

  if (canSee(field)) return <>{children}</>;

  return <>{fallback ?? (
    <div className="card-static py-16 px-5 text-center">
      <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-[var(--bg-overlay)] mb-3">
        <Lock size={16} className="text-[var(--text-3)]" />
      </div>
      <div className="text-[var(--text-2)] text-sm mb-1">Non partagé</div>
      <div className="text-[var(--text-3)] text-xs font-mono">
        {person?.name} n&apos;a pas rendu cette section publique
      </div>
    </div>
  )}</>;
}