"use client";

import React, { useEffect, useState } from "react";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // 从 localStorage 或系统偏好读取初始主题（默认深色 dark）
    const savedTheme = localStorage.getItem("app_theme") as "dark" | "light" | null;
    if (savedTheme === "light" || savedTheme === "dark") {
      setTheme(savedTheme);
      applyTheme(savedTheme);
    } else {
      setTheme("dark");
      applyTheme("dark");
    }
  }, []);

  const applyTheme = (t: "dark" | "light") => {
    const root = document.documentElement;
    if (t === "light") {
      root.classList.remove("dark");
      root.classList.add("light");
      root.setAttribute("data-theme", "light");
    } else {
      root.classList.remove("light");
      root.classList.add("dark");
      root.setAttribute("data-theme", "dark");
    }
  };

  const toggleTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    localStorage.setItem("app_theme", nextTheme);
    applyTheme(nextTheme);
  };

  if (!mounted) {
    return (
      <button
        type="button"
        className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shrink-0 cursor-pointer"
        aria-label="切换主题"
      >
        <img src="/guide/moon.svg" alt="深色模式" className="w-5 h-5 opacity-80" />
      </button>
    );
  }

  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={isDark ? "切换为浅色模式" : "切换为深色模式"}
      className={`w-10 h-10 rounded-full border flex items-center justify-center shrink-0 transition-all duration-300 cursor-pointer ${
        isDark
          ? "bg-white/5 hover:bg-white/10 border-white/15 text-white hover:shadow-[0_0_15px_rgba(175,167,255,0.2)]"
          : "bg-black/5 hover:bg-black/10 border-black/15 text-slate-800 hover:shadow-[0_0_15px_rgba(0,0,0,0.1)]"
      }`}
    >
      <img
        src={isDark ? "/guide/moon.svg" : "/guide/sun.svg"}
        alt={isDark ? "深色模式" : "浅色模式"}
        className={`w-5 h-5 transition-transform duration-300 ${
          isDark ? "rotate-0 text-white invert-0" : "rotate-180 text-amber-500"
        }`}
      />
    </button>
  );
}
