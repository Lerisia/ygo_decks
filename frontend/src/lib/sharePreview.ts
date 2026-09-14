// Shared sheets ship dark: the UI that turns a solo sheet into a shared one stays
// hidden until someone opens a page with ?share=1 (remembered afterwards, ?share=0 clears it).
// Sheets that are already shared always show their UI, so invited users need no flag.
const KEY = "sheet_share_preview";

export function sharePreviewEnabled(): boolean {
  try {
    const flag = new URLSearchParams(window.location.search).get("share");
    if (flag === "1") {
      localStorage.setItem(KEY, "1");
      return true;
    }
    if (flag === "0") {
      localStorage.removeItem(KEY);
      return false;
    }
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}
