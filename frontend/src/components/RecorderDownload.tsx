import { RECORDER_DOWNLOAD_URL } from "@/lib/siteMenu";
import { isWindows } from "@/lib/platform";

/** The recorder's 다운로드 button, on Windows only; elsewhere a note takes its place, so the pitch around it still
 *  shows (참혈 2026-10-15). */
export default function RecorderDownload({ className = "", note = "Windows PC 전용" }: { className?: string; note?: string }) {
  return isWindows() ? (
    <a
      href={RECORDER_DOWNLOAD_URL}
      download
      className={`block text-center px-6 py-3 rounded-lg font-extrabold bg-amber-400 hover:bg-amber-500 text-amber-950 transition ${className}`}
    >
      다운로드
    </a>
  ) : (
    <span
      className={`block text-center px-4 py-3.5 rounded-lg border border-dashed border-amber-300 dark:border-amber-700 text-sm leading-5 font-semibold text-amber-800 dark:text-amber-300 break-keep ${className}`}
    >
      {note}
    </span>
  );
}
