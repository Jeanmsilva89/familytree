"use client";

import { useEffect } from "react";

function syncViewport() {
  const vv = window.visualViewport;
  const height = Math.round(vv?.height ?? window.innerHeight);
  const top = Math.round(vv?.offsetTop ?? 0);
  const root = document.documentElement;
  root.style.setProperty("--vv-height", `${height}px`);
  root.style.setProperty("--vv-top", `${top}px`);
}

export function useVisualViewport() {
  useEffect(() => {
    syncViewport();
    const vv = window.visualViewport;
    vv?.addEventListener("resize", syncViewport);
    vv?.addEventListener("scroll", syncViewport);
    window.addEventListener("orientationchange", syncViewport);
    return () => {
      vv?.removeEventListener("resize", syncViewport);
      vv?.removeEventListener("scroll", syncViewport);
      window.removeEventListener("orientationchange", syncViewport);
    };
  }, []);
}

export function scrollFieldIntoSheet(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return;
  if (!target.matches("input, textarea, select")) return;
  window.setTimeout(() => {
    target.scrollIntoView({ block: "center", inline: "nearest" });
  }, 80);
}

export function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return;
    const body = document.body;
    const html = document.documentElement;
    const prevBody = body.style.overflow;
    const prevHtml = html.style.overflow;
    body.style.overflow = "hidden";
    html.style.overflow = "hidden";
    return () => {
      body.style.overflow = prevBody;
      html.style.overflow = prevHtml;
    };
  }, [locked]);
}
