/** The signed-in user's gems, shared by the pack simulator's pages (엘리스 10/13: always in view there): asked for once,
 *  then kept up to date by what a purchase returns. */
import { useEffect, useSyncExternalStore } from "react";
import { isAuthenticated } from "@/api/accountApi";

type State = { signedIn: boolean; gems: number | null };
let state: State = { signedIn: isAuthenticated(), gems: null };
const subs = new Set<() => void>();
let asking: Promise<void> | null = null;

const emit = (next: State) => {
  state = next;
  subs.forEach((f) => f());
};

export function setGems(gems: number) {
  emit({ signedIn: true, gems });
}

export function refreshGems() {
  if (!isAuthenticated()) {
    if (state.signedIn) emit({ signedIn: false, gems: null });
    return;
  }
  asking ??= fetch("/api/user/gems/history/?page_size=1", { headers: { Authorization: `Bearer ${localStorage.getItem("access_token")}` } })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => { if (d) setGems(d.gems); })
    .catch(() => {})
    .finally(() => { asking = null; });
}

export function useGems(): State {
  const now = useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => state);
  useEffect(() => { refreshGems(); }, []);
  return now;
}
