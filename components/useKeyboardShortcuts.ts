"use client";

import { useEffect } from "react";

type Shortcut = {
  key: string;                    // ex: "s", "n", "k"
  meta?: boolean;                  // ⌘ ou Ctrl
  shift?: boolean;
  action: () => void;
  description?: string;
};

/**
 * Hook global de raccourcis clavier. Ignore si l'utilisateur tape dans un input/textarea/select/editable.
 */
export function useKeyboardShortcuts(shortcuts: Shortcut[]) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore si focus dans un champ éditable
      const target = e.target as HTMLElement;
      const tag = target?.tagName?.toLowerCase();
      if (
        tag === "input" || tag === "textarea" || tag === "select" ||
        target?.isContentEditable
      ) {
        return;
      }

      for (const s of shortcuts) {
        const keyMatch = e.key.toLowerCase() === s.key.toLowerCase();
        const metaMatch = s.meta ? (e.metaKey || e.ctrlKey) : !(e.metaKey || e.ctrlKey);
        const shiftMatch = s.shift ? e.shiftKey : !e.shiftKey;

        if (keyMatch && metaMatch && shiftMatch) {
          e.preventDefault();
          s.action();
          return;
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shortcuts]);
}

export const SHORTCUTS_HELP = [
  { keys: ["N"], label: "Net Worth" },
  { keys: ["S"], label: "Stocks" },
  { keys: ["B"], label: "Banque" },
  { keys: ["I"], label: "Immo" },
  { keys: ["D"], label: "Dettes" },
  { keys: ["K"], label: "Par broker" },
  { keys: ["?"], label: "Afficher les raccourcis" },
];