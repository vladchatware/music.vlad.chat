"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

const storageKey = "revibe-backroom-theme";

function preferredTheme(): Theme {
  const stored = localStorage.getItem(storageKey);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(preferredTheme());
  }, []);

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    document.documentElement.dataset.backroomTheme = next;
    localStorage.setItem(storageKey, next);
    setTheme(next);
  }

  return (
    <button
      type="button"
      className="backroomThemeToggle"
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
    >
      <span aria-hidden="true">{theme === "light" ? "☼" : "◐"}</span>
      {theme ?? "theme"}
    </button>
  );
}
