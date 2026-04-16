"use client";

import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useCurrentUser } from "./UserContext";

export type PrivacyFields = {
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

type PersonInfo = {
  id: string;
  name: string;
  user_id: string | null;
};

type Ctx = {
  personId: string | null;
  person: PersonInfo | null;
  privacy: PrivacyFields | null;
  isEditable: boolean;
  canSee: (field: keyof Omit<PrivacyFields, "is_public">) => boolean;
  loading: boolean;
  reload: () => Promise<void>;
};

const defaultPrivacy: PrivacyFields = {
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
};

const PersonContext = createContext<Ctx>({
  personId: null, person: null, privacy: null,
  isEditable: false, canSee: () => false, loading: true,
  reload: async () => {},
});

export function PersonProvider({ personId, children }: { personId: string | null; children: ReactNode }) {
  const { user } = useCurrentUser();
  const [person, setPerson] = useState<PersonInfo | null>(null);
  const [privacy, setPrivacy] = useState<PrivacyFields | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!personId) { setPerson(null); setPrivacy(null); setLoading(false); return; }
    setLoading(true);
    const [pR, ppR] = await Promise.all([
      supabase.from("people").select("id, name, user_id").eq("id", personId).maybeSingle(),
      supabase.from("people_privacy").select("*").eq("person_id", personId).maybeSingle(),
    ]);
    setPerson(pR.data as PersonInfo | null);
    setPrivacy((ppR.data as PrivacyFields) || defaultPrivacy);
    setLoading(false);
  }, [personId]);

  useEffect(() => { load(); }, [load]);

  // isEditable = je suis admin OU owner de cette people
  const isEditable = Boolean(
    user && person && (user.is_admin || person.user_id === user.id)
  );

  // canSee(field) = je peux éditer OU la privacy m'y autorise
  const canSee = (field: keyof Omit<PrivacyFields, "is_public">) => {
    if (isEditable) return true;
    if (!privacy || !privacy.is_public) return false;
    return Boolean(privacy[field]);
  };

  return (
    <PersonContext.Provider value={{
      personId, person, privacy, isEditable, canSee, loading, reload: load,
    }}>
      {children}
    </PersonContext.Provider>
  );
}

export function usePerson() {
  return useContext(PersonContext);
}