"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Account, SubAccount, Broker, Holding } from "@/lib/types";
import { Plus, Trash2, Pencil, X, ArrowRightLeft, Check } from "lucide-react";

const fmt = (n: number | null | undefined, d = 2) =>
  n == null ? "—" : Number(n).toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });

const C = {
  accent: "#58a6ff", green: "#3fb950", red: "#f85149",
  border: "#1b2332", dim: "#484f58", muted: "#6e7681", bright: "#e6edf3",
};

type Props = {
  account: Account;
  subAccounts: SubAccount[];   // déjà filtrés pour ce compte
  brokers: Broker[];
  holdings: Holding[];         // toutes les holdings du compte (tous sub_accounts)
  latestFx: number;
  onChange: () => void;        // appelé après toute modif pour reload
  onNotify: (m: string) => void;
  onError: (m: string) => void;
};

export default function SubAccountManager({
  account, subAccounts, brokers, holdings, latestFx, onChange, onNotify, onError,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [addingNew, setAddingNew] = useState(false);
  const [newBrokerId, setNewBrokerId] = useState("");
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ broker_id: string; name: string; cash: string }>({ broker_id: "", name: "", cash: "0" });
  const [movingHolding, setMovingHolding] = useState<Holding | null>(null);
  const [moveTargetId, setMoveTargetId] = useState("");
  const [moveShares, setMoveShares] = useState("");
  const [moveAll, setMoveAll] = useState(true);

  const isCto = account.currency === "USD";
  const cur = isCto ? "$" : "€";

  const createSubAccount = async () => {
    if (!newBrokerId && !newName.trim()) {
      onError("Choisis un broker ou donne un nom");
      return;
    }
    try {
      await supabase.from("sub_accounts").insert({
        account_id: account.id,
        broker_id: newBrokerId || null,
        name: newName.trim() || null,
        cash: 0,
      });
      onNotify("✓ Sub-account créé");
      setNewBrokerId(""); setNewName(""); setAddingNew(false);
      onChange();
    } catch (e: any) {
      onError(e.message);
    }
  };

  const saveEdit = async (sa: SubAccount) => {
    try {
      const newCash = Number(editForm.cash);
      const oldCash = Number(sa.cash);
      const cashDelta = newCash - oldCash;

      await supabase.from("sub_accounts").update({
        broker_id: editForm.broker_id || null,
        name: editForm.name.trim() || null,
        cash: newCash,
        updated_at: new Date().toISOString(),
      }).eq("id", sa.id);

      // Synchroniser accounts.cash
      if (Math.abs(cashDelta) > 0.001) {
        const { data: acc } = await supabase.from("accounts").select("cash").eq("id", account.id).single();
        await supabase.from("accounts").update({
          cash: Math.round((Number(acc?.cash || 0) + cashDelta) * 100) / 100,
        }).eq("id", account.id);
      }

      onNotify("✓ Sub-account modifié");
      setEditingId(null);
      onChange();
    } catch (e: any) {
      onError(e.message);
    }
  };

  const deleteSubAccount = async (sa: SubAccount) => {
    // Vérifications : pas de holdings ni de cash
    const subHoldings = holdings.filter(h => h.sub_account_id === sa.id && Number(h.shares) > 0);
    if (subHoldings.length > 0) {
      onError(`Impossible : ${subHoldings.length} position(s) encore sur ce sub-account. Déplace-les d'abord.`);
      return;
    }
    if (Number(sa.cash) > 0.01) {
      onError(`Impossible : il reste ${fmt(sa.cash)}€ de cash sur ce sub-account. Vide-le d'abord.`);
      return;
    }
    // Vérifier qu'il en reste au moins un autre
    if (subAccounts.length <= 1) {
      onError("Tu dois garder au moins un sub-account par compte.");
      return;
    }
    if (!confirm(`Supprimer ce sub-account ?`)) return;
    try {
      await supabase.from("sub_accounts").delete().eq("id", sa.id);
      onNotify("✓ Sub-account supprimé");
      onChange();
    } catch (e: any) {
      onError(e.message);
    }
  };

  const performMove = async () => {
    if (!movingHolding || !moveTargetId) return;
    try {
      const totalShares = Number(movingHolding.shares);
      const sharesToMove = moveAll ? totalShares : Number(moveShares);

      if (sharesToMove <= 0 || sharesToMove > totalShares + 0.0001) {
        onError(`Quantité invalide (max ${totalShares})`);
        return;
      }

      if (moveAll || Math.abs(sharesToMove - totalShares) < 0.0001) {
        // Déplacement total : on change juste le sub_account_id
        await supabase.from("holdings").update({
          sub_account_id: moveTargetId,
        }).eq("id", movingHolding.id);
      } else {
        // Split : réduire la position source, créer/augmenter la cible
        // Check si cible a déjà ce ticker
        const { data: existing } = await supabase.from("holdings")
          .select("*")
          .eq("sub_account_id", moveTargetId)
          .eq("ticker", movingHolding.ticker)
          .maybeSingle();

        const newSourceShares = totalShares - sharesToMove;

        if (existing) {
          // Moyenne pondérée des PRU
          const exShares = Number(existing.shares);
          const exAvg = Number(existing.avg_cost);
          const srcAvg = Number(movingHolding.avg_cost);
          const newShares = exShares + sharesToMove;
          const newAvg = newShares > 0 ? (exShares * exAvg + sharesToMove * srcAvg) / newShares : exAvg;
          await supabase.from("holdings").update({
            shares: newShares,
            avg_cost: Math.round(newAvg * 100) / 100,
          }).eq("id", existing.id);
        } else {
          // Création
          await supabase.from("holdings").insert({
            account_id: movingHolding.account_id,
            sub_account_id: moveTargetId,
            ticker: movingHolding.ticker,
            label: movingHolding.label,
            shares: sharesToMove,
            avg_cost: movingHolding.avg_cost,
            last_price: movingHolding.last_price,
          });
        }

        // Réduire la source
        await supabase.from("holdings").update({
          shares: newSourceShares,
        }).eq("id", movingHolding.id);
      }

      onNotify(`✓ ${movingHolding.ticker} déplacé`);
      setMovingHolding(null); setMoveShares(""); setMoveTargetId(""); setMoveAll(true);
      onChange();
    } catch (e: any) {
      onError(e.message);
    }
  };

  const subAccountLabel = (sa: SubAccount) => {
    const brokerName = sa.brokers?.name || (sa.broker_id === null ? "Non assigné" : "?");
    return sa.name ? `${brokerName} · ${sa.name}` : brokerName;
  };

  // Holdings par sub_account (pour affichage dans chaque ligne)
  const holdingsBySubAcc = (saId: string) =>
    holdings.filter(h => h.sub_account_id === saId && Number(h.shares) > 0);

  return (
    <div className="bg-card border border-border rounded-lg mb-3">
      <button onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-2.5 flex items-center justify-between hover:bg-bg/30 transition-colors rounded-lg">
        <div className="flex items-center gap-2">
          <span className="text-bright text-[12px] font-semibold">{account.type}</span>
          <span className="text-dim text-[10px] font-mono">({account.currency})</span>
          <span className="text-muted text-[10px]">·</span>
          <span className="text-muted text-[10px] font-mono">{subAccounts.length} sub-account{subAccounts.length > 1 ? "s" : ""}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-dim font-mono">Total cash : {fmt(subAccounts.reduce((s, sa) => s + Number(sa.cash || 0), 0), 0)}€</span>
          <span className="text-dim text-[11px]">{expanded ? "▾" : "▸"}</span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border p-3 space-y-2">
          {subAccounts.map(sa => {
            const isEditing = editingId === sa.id;
            const subHoldings = holdingsBySubAcc(sa.id);
            const subValue = subHoldings.reduce((s, h) => s + Number(h.shares) * Number(h.last_price || 0), 0);
            const color = sa.brokers?.color || "#6b7280";

            return (
              <div key={sa.id} className="bg-bg border border-border rounded-md p-2.5">
                {isEditing ? (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <label className="block text-muted text-[9px] mb-1 uppercase tracking-wider">Broker</label>
                        <select value={editForm.broker_id} onChange={e => setEditForm({ ...editForm, broker_id: e.target.value })}
                          className="w-full py-[6px] px-[8px] bg-card border border-border rounded text-bright text-[12px] outline-none font-mono">
                          <option value="">— Non assigné —</option>
                          {brokers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                        </select>
                      </div>
                      <div className="flex-1">
                        <label className="block text-muted text-[9px] mb-1 uppercase tracking-wider">Nom (optionnel)</label>
                        <input value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                          placeholder="ex: perso"
                          className="w-full py-[6px] px-[8px] bg-card border border-border rounded text-bright text-[12px] outline-none font-mono placeholder:text-dim" />
                      </div>
                      <div className="w-[100px]">
                        <label className="block text-muted text-[9px] mb-1 uppercase tracking-wider">Cash €</label>
                        <input type="number" step="0.01" value={editForm.cash} onChange={e => setEditForm({ ...editForm, cash: e.target.value })}
                          className="w-full py-[6px] px-[8px] bg-card border border-border rounded text-bright text-[12px] outline-none font-mono" />
                      </div>
                    </div>
                    <div className="flex gap-1.5">
                      <button onClick={() => saveEdit(sa)}
                        className="py-1 px-3 bg-up text-white rounded text-[11px] font-medium inline-flex items-center gap-1">
                        <Check size={10} /> Sauver
                      </button>
                      <button onClick={() => setEditingId(null)}
                        className="py-1 px-3 bg-transparent border border-border text-muted rounded text-[11px]">
                        Annuler
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full" style={{ background: color }} />
                        <span className="text-bright text-[12px] font-medium">{subAccountLabel(sa)}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button onClick={() => {
                          setEditForm({ broker_id: sa.broker_id || "", name: sa.name || "", cash: String(sa.cash || 0) });
                          setEditingId(sa.id);
                        }} className="text-dim hover:text-accent p-1"><Pencil size={10} /></button>
                        <button onClick={() => deleteSubAccount(sa)} className="text-dim hover:text-down p-1"><Trash2 size={10} /></button>
                      </div>
                    </div>
                    <div className="text-[10px] text-muted font-mono mb-1.5">
                      Cash: {fmt(sa.cash, 0)}€ · Positions: {fmt(subValue, 0)}{cur} ({subHoldings.length})
                    </div>
                    {subHoldings.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {subHoldings.map(h => (
                          <button key={h.id} onClick={() => { setMovingHolding(h); setMoveTargetId(""); setMoveAll(true); }}
                            className="inline-flex items-center gap-1 bg-card border border-border rounded px-1.5 py-0.5 text-[10px] font-mono hover:border-dim">
                            <span className="text-bright">{h.ticker}</span>
                            <span className="text-dim">×{fmt(h.shares, Number(h.shares) % 1 === 0 ? 0 : 2)}</span>
                            <ArrowRightLeft size={8} className="text-dim" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Add new sub_account */}
          {addingNew ? (
            <div className="bg-bg border border-border rounded-md p-2.5 space-y-2">
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-muted text-[9px] mb-1 uppercase tracking-wider">Broker</label>
                  <select value={newBrokerId} onChange={e => setNewBrokerId(e.target.value)}
                    className="w-full py-[6px] px-[8px] bg-card border border-border rounded text-bright text-[12px] outline-none font-mono">
                    <option value="">— Choisir —</option>
                    {brokers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-muted text-[9px] mb-1 uppercase tracking-wider">Nom (optionnel)</label>
                  <input value={newName} onChange={e => setNewName(e.target.value)}
                    placeholder="ex: perso, pro"
                    className="w-full py-[6px] px-[8px] bg-card border border-border rounded text-bright text-[12px] outline-none font-mono placeholder:text-dim" />
                </div>
              </div>
              <div className="flex gap-1.5">
                <button onClick={createSubAccount}
                  className="py-1 px-3 bg-accent text-white rounded text-[11px] font-medium">Créer</button>
                <button onClick={() => { setAddingNew(false); setNewBrokerId(""); setNewName(""); }}
                  className="py-1 px-3 bg-transparent border border-border text-muted rounded text-[11px]">Annuler</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setAddingNew(true)}
              className="w-full py-2 border border-dashed border-border rounded-md text-muted text-[11px] hover:text-bright hover:border-dim transition-colors inline-flex items-center justify-center gap-1.5">
              <Plus size={11} /> Nouveau sub-account
            </button>
          )}
        </div>
      )}

      {/* Modal: déplacer un holding */}
      {movingHolding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setMovingHolding(null)}>
          <div onClick={e => e.stopPropagation()} className="bg-card border border-border rounded-xl p-6 w-[92%] max-w-[420px]">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-bright text-[14px] font-semibold">Déplacer {movingHolding.ticker}</h3>
              <button onClick={() => setMovingHolding(null)} className="text-muted hover:text-bright"><X size={16} /></button>
            </div>

            <div className="text-[11px] text-muted mb-3 font-mono">
              Position actuelle : {fmt(movingHolding.shares, Number(movingHolding.shares) % 1 === 0 ? 0 : 4)} {movingHolding.ticker}
            </div>

            <div className="mb-3">
              <label className="block text-muted text-[10px] mb-1 uppercase tracking-wider">Destination</label>
              <select value={moveTargetId} onChange={e => setMoveTargetId(e.target.value)}
                className="w-full py-[7px] px-[10px] bg-bg border border-border rounded-md text-bright text-[13px] outline-none font-mono">
                <option value="">— Choisir un sub-account —</option>
                {subAccounts
                  .filter(sa => sa.id !== movingHolding.sub_account_id)
                  .map(sa => (
                    <option key={sa.id} value={sa.id}>{subAccountLabel(sa)}</option>
                  ))}
              </select>
            </div>

            <div className="mb-3">
              <label className="flex items-center gap-2 text-[12px] text-bright cursor-pointer">
                <input type="checkbox" checked={moveAll} onChange={e => setMoveAll(e.target.checked)} className="accent-accent" />
                Déplacer toute la position
              </label>
            </div>

            {!moveAll && (
              <div className="mb-3">
                <label className="block text-muted text-[10px] mb-1 uppercase tracking-wider">Quantité à déplacer</label>
                <input type="number" step="any" value={moveShares} onChange={e => setMoveShares(e.target.value)}
                  placeholder={`Max ${movingHolding.shares}`}
                  className="w-full py-[7px] px-[10px] bg-bg border border-border rounded-md text-bright text-[13px] outline-none font-mono placeholder:text-dim" />
                <div className="text-[9px] text-dim mt-1">Le PRU sera conservé. Si la cible a déjà {movingHolding.ticker}, moyenne pondérée.</div>
              </div>
            )}

            <button onClick={performMove} disabled={!moveTargetId || (!moveAll && !moveShares)}
              className="w-full py-2 bg-accent text-white rounded-md text-[13px] font-medium disabled:opacity-40">
              Déplacer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}