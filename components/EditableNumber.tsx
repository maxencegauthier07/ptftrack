"use client";

import { useState, useRef, useEffect } from "react";

const fmt = (n: number, d = 2) =>
  Number(n).toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });

type Props = {
  value: number;
  onSave: (newValue: number) => Promise<void> | void;
  decimals?: number;
  suffix?: string;            // ex: "€", "$"
  className?: string;         // pour le style normal
  editClassName?: string;     // pour le style en mode édition
  disabled?: boolean;
  onError?: (msg: string) => void;
};

/**
 * Affiche un nombre, cliquable. Au clic, devient un input. Au blur ou Enter, sauvegarde.
 * Esc annule. Affiche un flash vert/rouge selon le delta.
 */
export default function EditableNumber({
  value, onSave, decimals = 0, suffix = "", className, editClassName, disabled, onError,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<"green" | "red" | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  // Si la value externe change (ex: reload), reset le draft
  useEffect(() => {
    if (!editing) setDraft(String(value));
  }, [value, editing]);

  const startEdit = () => {
    if (disabled || saving) return;
    setDraft(String(value));
    setEditing(true);
  };

  const cancel = () => {
    setEditing(false);
    setDraft(String(value));
  };

  const commit = async () => {
    const newVal = Number(draft);
    if (isNaN(newVal)) {
      onError?.("Valeur invalide");
      cancel();
      return;
    }
    if (Math.abs(newVal - value) < 0.001) {
      // Pas de changement
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(newVal);
      setFlash(newVal > value ? "green" : "red");
      setTimeout(() => setFlash(null), 800);
    } catch (e: any) {
      onError?.(e.message || "Erreur de sauvegarde");
    }
    setSaving(false);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="number"
        step="any"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") cancel();
        }}
        disabled={saving}
        className={`bg-transparent outline outline-1 outline-[var(--accent)] rounded px-1 py-0 font-mono ${editClassName || className || ""}`}
        style={{ width: `${Math.max(draft.length, 6)}ch`, minWidth: "60px" }}
      />
    );
  }

  return (
    <span
      onClick={startEdit}
      className={`editable ${className || ""} ${flash === "green" ? "flash-green" : ""} ${flash === "red" ? "flash-red" : ""} ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
      title={disabled ? "" : "Cliquer pour modifier"}
    >
      {fmt(value, decimals)}{suffix && <span className="ml-0.5">{suffix}</span>}
    </span>
  );
}