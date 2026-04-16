"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, User, LogIn } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null); setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur");
      // ★ Full reload au lieu de router.push : force UserProvider à s'initialiser
      // avec le cookie de session fraîchement posé, avant que les composants ne se montent
      window.location.href = "/";
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center p-5">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="font-mono text-xl font-bold mb-2">
            <span className="text-[var(--accent)]">$</span> ptftrack
          </div>
          <div className="text-[var(--text-3)] text-sm">Connecte-toi pour voir ton patrimoine</div>
        </div>

        <form onSubmit={submit} className="card-static p-6 space-y-4">
          <div>
            <label className="block text-[var(--text-3)] text-[10px] mb-1.5 uppercase tracking-wider">
              Username
            </label>
            <div className="relative">
              <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-4)]" />
              <input
                autoFocus
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="ton_username"
                className="input !pl-9"
              />
            </div>
          </div>

          <div>
            <label className="block text-[var(--text-3)] text-[10px] mb-1.5 uppercase tracking-wider">
              Mot de passe
            </label>
            <div className="relative">
              <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-4)]" />
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="input !pl-9"
              />
            </div>
          </div>

          {err && (
            <div className="bg-[var(--red-bg)] border border-[var(--red)]/30 rounded-md py-2 px-3 text-[var(--red)] text-[11px] font-mono">
              {err}
            </div>
          )}

          <button
            type="submit"
            disabled={!username || !password || loading}
            className="btn btn-primary w-full justify-center"
          >
            <LogIn size={12} /> {loading ? "Connexion..." : "Se connecter"}
          </button>
        </form>

        <div className="text-center mt-6 text-[10px] text-[var(--text-4)] font-mono">
          Pas de compte ? Demande à l&apos;admin
        </div>
      </div>
    </div>
  );
}