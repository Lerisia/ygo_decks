import type { Border, PublicCardIcon } from "@/api/avatarApi";

const BASE = "/api/solo/names";

export type Answer = { name: string; ms: number };
export type RankRow = { name: string; guest: boolean; count: number; avatar_icon: PublicCardIcon | null; border: Border | null };
export type Leaderboard = { leaderboard: RankRow[]; players: number; my_best: number | null };
export type SubmitResult = { count: number; rank: number; best: number; players: number };

/** The saved login is no longer accepted; the game goes on as a guest. */
export class LoginExpired extends Error {}

export function hasLogin() {
  return !!localStorage.getItem("access_token");
}

async function call<T>(path: string, init: RequestInit, withLogin: boolean): Promise<T> {
  const token = withLogin ? localStorage.getItem("access_token") : null;
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (res.status === 401 && token) throw new LoginExpired();
  if (!res.ok) {
    let msg = res.status === 429 ? "잠시 후 다시 시도해 주세요." : `오류가 났습니다 (${res.status}).`;
    try {
      msg = (await res.json()).error || msg;
    } catch {
      /* not JSON: keep the generic message */
    }
    throw new Error(msg);
  }
  return res.json();
}

export const startGame = () => call<{ token: string }>("/start/", { method: "POST" }, false).then((r) => r.token);

export const submitGame = (token: string, answers: Answer[], nickname: string | null) =>
  call<SubmitResult>("/submit/", { method: "POST", body: JSON.stringify({ token, answers, nickname }) }, nickname === null);

/** A stale login only costs the "my best" line, so the board is read again without it. */
export const fetchLeaderboard = () =>
  call<Leaderboard>("/leaderboard/", {}, true).catch((e) => {
    if (e instanceof LoginExpired) return call<Leaderboard>("/leaderboard/", {}, false);
    throw e;
  });
