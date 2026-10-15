import { RECORDER_DOWNLOAD_URL } from "@/lib/siteMenu";
import { isWindows } from "@/lib/platform";

/** The recorder's 다운로드 button, on Windows only (참혈 2026-10-15). Elsewhere nothing takes its place but `note`, as
 *  plain text, if given; the cards say "Windows 전용" by their title instead (WindowsOnly, 참혈 2026-10-15). */
export default function RecorderDownload({ className = "", note }: { className?: string; note?: string }) {
  if (isWindows()) {
    return (
      <a
        href={RECORDER_DOWNLOAD_URL}
        download
        className={`block text-center px-6 py-3 rounded-lg font-extrabold bg-amber-400 hover:bg-amber-500 text-amber-950 transition ${className}`}
      >
        다운로드
      </a>
    );
  }
  return note ? <p className={`text-sm text-gray-600 dark:text-gray-300 break-keep ${className}`}>{note}</p> : null;
}

/** A small "Windows 전용" beside a recorder card's title, on every device. */
export function WindowsOnly() {
  return <span className="ml-1.5 align-middle text-xs font-semibold tracking-normal text-gray-500 dark:text-gray-400 whitespace-nowrap">Windows 전용</span>;
}
