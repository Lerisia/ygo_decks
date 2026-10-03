export const STALE_YEARS = 2;

/** True when a lecture note was published more than STALE_YEARS ago (undated notes are never stale). */
export const isStaleNote = (iso: string | null, now = new Date()) => {
  if (!iso) return false;
  const cutoff = new Date(now);
  cutoff.setFullYear(cutoff.getFullYear() - STALE_YEARS);
  return new Date(iso) < cutoff;
};
