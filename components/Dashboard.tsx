"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import type { Person } from "@/lib/types";
import StocksDashboard from "./StocksDashboard";
import BrokerView from "./BrokerView";
import BankView from "./BankView";
import RealEstateView from "./RealEstateView";
import LoansView from "./LoansView";
import NetWorthView from "./NetWorthView";
import PrivacyView from "./PrivacyView";
import { useCurrentUser } from "./UserContext";
import { PersonProvider } from "./PersonContext";
import { ReadOnlyWrapper, PrivacyGate } from "./ReadOnly";
import { Plus, TrendingUp, Landmark, Home as HomeIcon, CreditCard, Wallet, Gem, Keyboard, X, Shield, LogOut } from "lucide-react";
import { useKeyboardShortcuts, SHORTCUTS_HELP } from "./useKeyboardShortcuts";

type Module = "networth" | "stocks" | "brokers" | "bank" | "realestate" | "loans" | "privacy";

const MODULES: { key: Module; label: string; icon: any; shortcut: string }[] = [
  { key: "networth",   label: "Net Worth",  icon: Gem,        shortcut: "N" },
  { key: "stocks",     label: "Stocks",     icon: TrendingUp, shortcut: "S" },
  { key: "brokers",    label: "Brokers",    icon: Wallet,     shortcut: "K" },
  { key: "bank",       label: "Banque",     icon: Landmark,   shortcut: "B" },
  { key: "realestate", label: "Immo",       icon: HomeIcon,   shortcut: "I" },
  { key: "loans",      label: "Dettes",     icon: CreditCard, shortcut: "D" },
  { key: "privacy",    label: "Privacy",    icon: Shield,     shortcut: "P" },
];

export default function Dashboard() {
  const { user, logout } = useCurrentUser();
  const [people, setPeople] = useState<Person[]>([]);
  const [person, setPerson] = useState<string | null>(null);
  const [module, setModule] = useState<Module>("networth");
  const [loading, setLoading] = useState(true);
  const [showAddPerson, setShowAddPerson] = useState(false);
  const [newName, setNewName] = useState("");
  const [showHelp, setShowHelp] = useState(false);

  const loadPeople = useCallback(async () => {
    const { data } = await supabase.from("people").select("*").order("name");
    const list = (data || []) as Person[];
    setPeople(list);
    if (!person && list.length) {
      // Priorité : une people dont je suis owner, sinon la première visible
      const mine = user ? list.find(p => p.user_id === user.id) : null;
      setPerson((mine ?? list[0]).id);
    }
    setLoading(false);
  }, [person, user]);

  useEffect(() => { loadPeople(); }, [loadPeople]);

  useKeyboardShortcuts([
    { key: "n", action: () => setModule("networth") },
    { key: "s", action: () => setModule("stocks") },
    { key: "k", action: () => setModule("brokers") },
    { key: "b", action: () => setModule("bank") },
    { key: "i", action: () => setModule("realestate") },
    { key: "d", action: () => setModule("loans") },
    { key: "p", action: () => setModule("privacy") },
    { key: "?", shift: true, action: () => setShowHelp(h => !h) },
    { key: "Escape", action: () => { setShowHelp(false); setShowAddPerson(false); } },
  ]);

  const addPerson = async () => {
    if (!newName.trim()) return;
    const { data } = await supabase.from("people").insert({ name: newName.trim() }).select();
    if (data?.[0]) {
      const { data: accs } = await supabase.from("accounts").insert([
        { person_id: data[0].id, type: "PEA", currency: "EUR", benchmark: "CAC40" },
        { person_id: data[0].id, type: "CTO", currency: "USD", benchmark: "SP500" },
      ]).select();
      if (accs) {
        await supabase.from("sub_accounts").insert(
          accs.map(a => ({ account_id: a.id, broker_id: null, name: null, cash: 0 }))
        );
      }
      // Crée aussi la privacy par défaut (privée)
      await supabase.from("people_privacy").insert({ person_id: data[0].id, is_public: false });
      setPerson(data[0].id);
    }
    setNewName(""); setShowAddPerson(false); loadPeople();
  };

  if (loading) {
    return <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center"><span className="font-mono text-[var(--text-3)] text-sm">loading...</span></div>;
  }

  if (people.length === 0 && module !== "privacy") {
    return (
      <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center p-5">
        <div className="card-static p-6 max-w-sm text-center">
          <div className="text-[var(--text-1)] text-sm font-semibold mb-2">Bienvenue sur ptftrack</div>
          <div className="text-[var(--text-2)] text-xs mb-4">Crée ta première personne pour commencer</div>
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Ton prénom"
            className="input mb-3" />
          <button onClick={addPerson} disabled={!newName.trim()}
            className="btn btn-primary w-full justify-center">
            Créer
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text-1)]">
      <div className="border-b border-[var(--border)] py-2.5 px-5 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3.5">
          <span className="font-mono text-sm font-bold"><span className="text-[var(--accent)]">$</span> ptftrack</span>
          <div className="flex gap-0.5 bg-[var(--bg-overlay)] rounded-md p-0.5">
            {people.map(p => (
              <button key={p.id} onClick={() => setPerson(p.id)}
                className={`py-[5px] px-3 rounded text-[11px] font-medium transition-all border
                  ${person === p.id ? "bg-[var(--bg-raised)] text-[var(--text-1)] border-[var(--border)]" : "bg-transparent text-[var(--text-3)] border-transparent hover:text-[var(--text-2)]"}`}>
                {p.name}
              </button>
            ))}
            {showAddPerson ? (
              <div className="flex items-center gap-1 px-1.5">
                <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") addPerson(); if (e.key === "Escape") { setShowAddPerson(false); setNewName(""); } }}
                  placeholder="Nom" className="w-20 bg-transparent text-[var(--text-1)] text-[11px] outline-none font-mono" />
              </div>
            ) : (
              <button onClick={() => setShowAddPerson(true)}
                className="text-[var(--text-3)] text-[10px] px-2 py-0.5 hover:text-[var(--text-2)]"><Plus size={10} /></button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex gap-0.5 bg-[var(--bg-overlay)] rounded-md p-0.5 overflow-x-auto">
            {MODULES.map(m => {
              const Ico = m.icon;
              const isActive = module === m.key;
              return (
                <button key={m.key} onClick={() => setModule(m.key)}
                  title={`${m.label} (${m.shortcut})`}
                  className={`py-[5px] px-3 rounded text-[11px] font-medium transition-all border inline-flex items-center gap-1.5 whitespace-nowrap
                    ${isActive ? "bg-[var(--bg-raised)] text-[var(--text-1)] border-[var(--border)]" : "bg-transparent text-[var(--text-3)] border-transparent hover:text-[var(--text-2)]"}`}>
                  <Ico size={11} />
                  {m.label}
                </button>
              );
            })}
          </div>

          <button onClick={() => setShowHelp(true)} title="Raccourcis clavier (?)"
            className="text-[var(--text-3)] hover:text-[var(--text-2)] p-1.5 rounded hover:bg-[var(--bg-overlay)] transition-colors">
            <Keyboard size={13} />
          </button>

          {/* User menu */}
          {user && (
            <div className="flex items-center gap-2 ml-1 pl-2 border-l border-[var(--border)]">
              <span className="text-[var(--text-2)] text-[11px] font-mono">
                {user.display_name || user.username}
                {user.is_admin && <span className="text-[var(--accent)] ml-1">★</span>}
              </span>
              <button onClick={logout} title="Se déconnecter"
                className="text-[var(--text-3)] hover:text-[var(--red)] p-1.5 rounded hover:bg-[var(--bg-overlay)] transition-colors">
                <LogOut size={13} />
              </button>
            </div>
          )}
        </div>
      </div>

      {module === "privacy" && <PrivacyView />}
      {person && module !== "privacy" && (
        <PersonProvider personId={person}>
          <ReadOnlyWrapper>
            {module === "networth"   && (
              <PrivacyGate field="show_networth_total"><NetWorthView personId={person} /></PrivacyGate>
            )}
            {module === "stocks"     && (
              <PrivacyGate field="show_stocks_detail"><StocksDashboard personId={person} /></PrivacyGate>
            )}
            {module === "brokers"    && (
              <PrivacyGate field="show_stocks_detail"><BrokerView personId={person} /></PrivacyGate>
            )}
            {module === "bank"       && (
              <PrivacyGate field="show_bank"><BankView personId={person} /></PrivacyGate>
            )}
            {module === "realestate" && (
              <PrivacyGate field="show_real_estate"><RealEstateView personId={person} /></PrivacyGate>
            )}
            {module === "loans"      && (
              <PrivacyGate field="show_loans"><LoansView personId={person} /></PrivacyGate>
            )}
          </ReadOnlyWrapper>
        </PersonProvider>
      )}

      {showHelp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in"
          onClick={() => setShowHelp(false)}>
          <div onClick={e => e.stopPropagation()}
            className="card-static p-6 w-[92%] max-w-[420px] animate-fade-up">
            <div className="flex justify-between items-center mb-5">
              <h3 className="text-[var(--text-1)] text-base font-semibold">Raccourcis clavier</h3>
              <button onClick={() => setShowHelp(false)} className="text-[var(--text-2)] hover:text-[var(--text-1)]"><X size={16} /></button>
            </div>

            <div className="space-y-2.5">
              {SHORTCUTS_HELP.map(s => (
                <div key={s.label} className="flex items-center justify-between">
                  <span className="text-sm text-[var(--text-2)]">{s.label}</span>
                  <div className="flex gap-1">
                    {s.keys.map(k => (
                      <kbd key={k}
                        className="inline-flex items-center justify-center min-w-[24px] h-[24px] px-1.5 bg-[var(--bg-overlay)] border border-[var(--border)] rounded text-[11px] font-mono text-[var(--text-1)]">
                        {k}
                      </kbd>
                    ))}
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between pt-2 border-t border-[var(--border)]">
                <span className="text-sm text-[var(--text-2)]">Privacy</span>
                <kbd className="inline-flex items-center justify-center min-w-[24px] h-[24px] px-1.5 bg-[var(--bg-overlay)] border border-[var(--border)] rounded text-[11px] font-mono text-[var(--text-1)]">P</kbd>
              </div>
            </div>

            <div className="mt-5 pt-4 border-t border-[var(--border)] text-[10px] text-[var(--text-3)] font-mono">
              Astuce : les raccourcis sont désactivés quand tu écris dans un champ
            </div>
          </div>
        </div>
      )}
    </div>
  );
}