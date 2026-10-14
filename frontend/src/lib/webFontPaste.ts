/** Web fonts pasted on /dev/cardlayout (참혈 2026-10-14): a Google Fonts <link> tag, an @import url(…) line or
 *  @font-face rules, put on the page without any file on our server. */

/** The stylesheet addresses (<link href>, @import) and the @font-face rules in what was pasted. */
export function parseFontPaste(text: string) {
  const urls: string[] = [];
  for (const m of text.matchAll(/<link\b[^>]*?\bhref\s*=\s*(["'])(.*?)\1[^>]*>/gi)) urls.push(m[2]);
  for (const m of text.matchAll(/@import\s+(?:url\(\s*(["']?)(.*?)\1\s*\)|(["'])(.*?)\3)/gi)) urls.push(m[2] ?? m[4]);
  if (!urls.length && /^\s*https?:\/\/\S+\s*$/.test(text)) urls.push(text.trim());
  return { urls: urls.map((u) => u.replace(/&amp;/g, "&")), css: fontFaceRules(text) };
}

/** Only the @font-face rules of a stylesheet: nothing else in it may restyle the page. */
export function fontFaceRules(css: string) {
  return (css.replace(/\/\*[\s\S]*?\*\//g, "").match(/@font-face\s*\{[^}]*\}/gi) ?? []).join("\n");
}

/** The url(…)s of a stylesheet made absolute against where it came from. */
export function absoluteUrls(css: string, base: string) {
  return css.replace(/url\(\s*(["']?)(.*?)\1\s*\)/g, (whole, q: string, u: string) => {
    if (/^(data|blob):/i.test(u)) return whole;
    try {
      return `url(${q}${new URL(u, base).href}${q})`;
    } catch {
      return whole;
    }
  });
}

const unquote = (s: string) => s.trim().replace(/^(["'])(.*)\1$/, "$2");

export type PastedFamily = { family: string; weights: number[]; ranges: [number, number][] };

const weightOf = (part: string) => (part === "bold" ? 700 : part === "normal" ? 400 : Number(part));

/** Each family the rules name with the weights they give it: one weight ("700"), or a variable font's range ("100 900"). */
export function weightsOf(descriptors: string[]) {
  const weights = new Set<number>();
  const ranges: [number, number][] = [];
  for (const d of descriptors) {
    const parts = d.trim().split(/\s+/).map(weightOf).filter((n) => n >= 1 && n <= 1000);
    if (parts.length === 2 && parts[0] !== parts[1]) ranges.push([Math.min(...parts), Math.max(...parts)]);
    else if (parts.length) weights.add(parts[0]);
  }
  return { weights: [...weights].sort((a, b) => a - b), ranges };
}

export function familiesInCss(css: string): PastedFamily[] {
  const out = new Map<string, string[]>();
  for (const rule of css.match(/@font-face\s*\{[^}]*\}/gi) ?? []) {
    const family = rule.match(/font-family\s*:\s*([^;}]+)/i);
    if (!family) continue;
    const name = unquote(family[1]);
    out.set(name, [...(out.get(name) ?? []), rule.match(/font-weight\s*:\s*([^;}]+)/i)?.[1] ?? "400"]);
  }
  return [...out].map(([family, descriptors]) => ({ family, ...weightsOf(descriptors) }));
}

/** A Google Fonts address's family names (family=Noto+Serif+KR:wght@700), for a sheet that can't be read. */
export function googleFamilies(url: string) {
  try {
    const u = new URL(url);
    return u.searchParams.getAll("family").map((f) => f.split(":")[0].replace(/\+/g, " "));
  } catch {
    return [];
  }
}

export type PastedFont = { source: string; families: PastedFamily[]; error?: string };

const ATTR = "data-cardlayout-font";

/** Puts the pasted fonts on the page (one <style> per paste, keyed by id) and reports their families. A sheet that
 *  can't be fetched (no CORS) goes in as a <link>, its families read off its address and document.fonts. */
export async function installPastedFont(id: string, source: string): Promise<PastedFont> {
  removePastedFont(id);
  const { urls, css } = parseFontPaste(source);
  const before = new Set([...document.fonts].map((f) => unquote(f.family)));
  let rules = css;
  const guessed: string[] = [];
  for (const url of urls) {
    try {
      const res = await fetch(url, { mode: "cors" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      rules += "\n" + absoluteUrls(fontFaceRules(await res.text()), url);
    } catch {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = url;
      link.setAttribute(ATTR, id);
      await new Promise((done) => {
        link.onload = link.onerror = done;
        document.head.appendChild(link);
      });
      guessed.push(...googleFamilies(url));
    }
  }
  if (rules.trim()) {
    const style = document.createElement("style");
    style.setAttribute(ATTR, id);
    style.textContent = rules;
    document.head.appendChild(style);
  }
  await document.fonts.ready;
  const families = familiesInCss(rules);
  const named = new Set(families.map((f) => f.family));
  const added = [...document.fonts].map((f) => unquote(f.family)).filter((f) => !before.has(f));
  for (const family of [...guessed, ...added]) {
    if (!named.has(family)) {
      named.add(family);
      families.push({ family, ...weightsOf([...document.fonts].filter((f) => unquote(f.family) === family).map((f) => f.weight)) });
    }
  }
  if (!families.length) return { source, families, error: "글꼴 이름(font-family)을 찾지 못했습니다." };
  return { source, families };
}

export function removePastedFont(id: string) {
  document.querySelectorAll(`[${ATTR}="${id}"]`).forEach((el) => el.remove());
}
