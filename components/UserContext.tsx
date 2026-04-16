"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { setSupabaseSessionToken } from "@/lib/supabase";

type User = {
  id: string;
  username: string;
  display_name: string | null;
  is_admin: boolean;
};

type Ctx = {
  user: User | null;
  loading: boolean;
  logout: () => Promise<void>;
};

const UserContext = createContext<Ctx>({ user: null, loading: true, logout: async () => {} });

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/auth/me");
        const data = await res.json();
        // ★ Injecte le token AVANT de set "ready" → les enfants se mounteront
        // uniquement quand le token est déjà dans le client Supabase
        setSupabaseSessionToken(data.token || null);
        setUser(data.user);
      } catch {
        setSupabaseSessionToken(null);
      }
      setLoading(false);
      setReady(true);
    })();
  }, []);

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setSupabaseSessionToken(null);
    window.location.href = "/login";
  };

  // ★ Ne rend les enfants QUE quand le token est prêt
  // → évite la race condition où les composants chargent des données
  //   avant que le token ne soit injecté dans le client Supabase
  if (!ready) {
    return (
      <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center">
        <span className="font-mono text-[var(--text-3)] text-sm">loading session...</span>
      </div>
    );
  }

  return (
    <UserContext.Provider value={{ user, loading, logout }}>
      {children}
    </UserContext.Provider>
  );
}

export function useCurrentUser() {
  return useContext(UserContext);
}