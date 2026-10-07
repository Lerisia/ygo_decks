import { useSyncExternalStore } from "react";

// Staff-only watch on the 문의 게시판 (특이점 2026-10-07): the top bar's 문의 badge and the new-inquiry popup read
// this one store, so the site asks the server once a minute at most, and only while the tab is in view.
export type InquiryAlerts = {
  unanswered: number;
  by_board: Record<string, number>;
  latest: { id: number; board: string; board_label: string; created_at: string; answered: boolean } | null;
};

const POLL_MS = 60_000;
let state: InquiryAlerts | null = null;
let timer: number | null = null;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

async function poll() {
  if (timer === null || document.visibilityState !== "visible") return;
  const token = localStorage.getItem("access_token");
  if (!token) return stopInquiryAlerts();
  try {
    const res = await fetch("/api/inquiry/alerts/", { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401 || res.status === 403) return stopInquiryAlerts();
    if (!res.ok) return;
    state = await res.json();
    emit();
  } catch {
    /* offline for a moment: the next tick tries again */
  }
}

const onVisible = () => {
  if (document.visibilityState === "visible") poll();
};

/** Called once the top bar knows the visitor is staff. */
export function startInquiryAlerts() {
  if (timer !== null) return;
  timer = window.setInterval(poll, POLL_MS);
  document.addEventListener("visibilitychange", onVisible);
  poll();
}

export function stopInquiryAlerts() {
  if (timer !== null) window.clearInterval(timer);
  timer = null;
  document.removeEventListener("visibilitychange", onVisible);
  if (state) {
    state = null;
    emit();
  }
}

/** After an answer or a delete, so the badge does not wait for the next minute. */
export function refreshInquiryAlerts() {
  poll();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useInquiryAlerts(): InquiryAlerts | null {
  return useSyncExternalStore(subscribe, () => state);
}
