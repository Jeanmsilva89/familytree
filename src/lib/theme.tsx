"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useVisualViewport } from "@/hooks/useVisualViewport";

export const THEME_KEY = "familytree-theme";
export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

function resolve(preference: ThemePreference): ResolvedTheme {
  if (preference === "system") {
    if (typeof window === "undefined") return "light";
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return preference;
}

function readStored(): ThemePreference {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(THEME_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") return stored;
  return "system";
}

type ThemeContextValue = {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (next: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>("system");
  const [resolved, setResolved] = useState<ResolvedTheme>("light");
  const [hydrated, setHydrated] = useState(false);
  useVisualViewport();

  useEffect(() => {
    setPreferenceState(readStored());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const apply = () => {
      const next = resolve(preference);
      setResolved(next);
      document.documentElement.setAttribute("data-theme", next);
    };
    apply();
    try {
      window.localStorage.setItem(THEME_KEY, preference);
    } catch {
      /* ignore quota */
    }
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [preference, hydrated]);

  const value = useMemo(
    () => ({
      preference,
      resolved,
      setPreference: (next: ThemePreference) => setPreferenceState(next),
    }),
    [preference, resolved],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    return {
      preference: "system",
      resolved: "light",
      setPreference: () => undefined,
    };
  }
  return ctx;
}
