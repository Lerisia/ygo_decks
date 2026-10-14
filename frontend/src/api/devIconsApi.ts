/** /dev/icons' operator API: the icon picked for each emoji, saved for the coding bot to read (참혈 2026-10-15). */
export type IconLib = "fa" | "fa-regular" | "remix-fill" | "remix-line" | "material-icons" | "material-symbols";
export type IconChoice = { lib: IconLib; name: string };
export type IconChoices = {
  choices?: Record<string, IconChoice>;
  /** Remix names typed by hand, by row */
  custom?: Record<string, string>;
  saved_by?: string;
  saved_at?: string;
};

const URL = "/api/dev/icon-choices/";

function headers(): HeadersInit {
  const token = localStorage.getItem("access_token");
  return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

async function read(res: Response): Promise<IconChoices> {
  if (res.status === 401 || res.status === 403) throw new Error("관리자 권한이 필요합니다.");
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

export const getIconChoices = () => fetch(URL, { headers: headers() }).then(read);

export const saveIconChoices = (choices: Record<string, IconChoice>, custom: Record<string, string>) =>
  fetch(URL, { method: "PUT", headers: headers(), body: JSON.stringify({ choices, custom }) }).then(read);
