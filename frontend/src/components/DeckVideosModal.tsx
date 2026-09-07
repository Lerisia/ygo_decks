import { useEffect, useState } from "react";
import { getDeckVideos, DeckVideo, DeckVideosResponse } from "@/api/deckApi";

type Props = {
  deckId: number;
  deckName: string;
  onClose: () => void;
};

const formatDuration = (sec: number | null) => {
  if (sec == null) return null;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
};

const formatViews = (n: number | null) => {
  if (n == null) return null;
  if (n >= 10000) return `조회수 ${(n / 10000).toFixed(n >= 100000 ? 0 : 1)}만회`;
  if (n >= 1000) return `조회수 ${(n / 1000).toFixed(1)}천회`;
  return `조회수 ${n}회`;
};

const formatDate = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  const abs = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
  if (days < 1) return `오늘 · ${abs}`;
  if (days < 30) return `${days}일 전 · ${abs}`;
  if (days < 365) return `${Math.floor(days / 30)}개월 전 · ${abs}`;
  return `${Math.floor(days / 365)}년 전 · ${abs}`;
};

function VideoCard({ video }: { video: DeckVideo }) {
  const duration = formatDuration(video.duration);
  const meta = [formatDate(video.published_at), formatViews(video.view_count)].filter(Boolean).join(" · ");
  return (
    <a
      href={video.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex gap-3 p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700/60 transition group"
    >
      <div className="relative flex-shrink-0 w-36 sm:w-44 aspect-video rounded-md overflow-hidden bg-gray-200 dark:bg-gray-700">
        <img
          src={video.thumbnail_url || `https://i.ytimg.com/vi/${video.video_id}/hqdefault.jpg`}
          alt=""
          loading="lazy"
          className="w-full h-full object-cover group-hover:scale-105 transition-transform"
        />
        {duration && (
          <span className="absolute bottom-1 right-1 px-1 rounded bg-black/80 text-white text-[11px] font-semibold">{duration}</span>
        )}
      </div>
      <div className="min-w-0 flex-1 flex flex-col justify-center text-left">
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 line-clamp-2 leading-snug">{video.title}</p>
        {meta && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{meta}</p>}
      </div>
    </a>
  );
}

export default function DeckVideosModal({ deckId, deckName, onClose }: Props) {
  const [data, setData] = useState<DeckVideosResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    getDeckVideos(deckId)
      .then((res) => alive && setData(res))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [deckId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const channelName = data?.channel.name ?? "김빠방";
  const channelUrl = data?.channel.url ?? "https://www.youtube.com/@%EA%B9%80%EB%B9%A0%EB%B0%A9";

  return (
    <div
      className="fixed inset-0 bg-black/60 z-[55] flex items-center justify-center p-2 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${deckName} 플레이 영상`}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <span className="inline-flex w-7 h-7 rounded-full bg-red-600 text-white text-xs items-center justify-center flex-shrink-0">▶</span>
          <div className="min-w-0 flex-1 text-left">
            <p className="font-bold text-gray-900 dark:text-gray-100 truncate">{deckName} 플레이 영상</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {channelName} 채널
              {data ? ` · ${data.videos.length}개 · 최신순` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="w-8 h-8 rounded-full text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 dark:text-gray-400 text-xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="overflow-y-auto p-2 sm:p-3">
          {error ? (
            <p className="py-10 text-center text-sm text-gray-500 dark:text-gray-400">영상 목록을 불러오지 못했습니다.</p>
          ) : !data ? (
            <div className="space-y-2 animate-pulse">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex gap-3 p-2">
                  <div className="w-36 sm:w-44 aspect-video rounded-md bg-gray-200 dark:bg-gray-700" />
                  <div className="flex-1 space-y-2 py-2">
                    <div className="h-3.5 rounded bg-gray-200 dark:bg-gray-700 w-11/12" />
                    <div className="h-3.5 rounded bg-gray-200 dark:bg-gray-700 w-2/3" />
                    <div className="h-3 rounded bg-gray-200 dark:bg-gray-700 w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : data.videos.length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-500 dark:text-gray-400">아직 이 덱의 영상이 없습니다.</p>
          ) : (
            <div className="space-y-1">
              {data.videos.map((v) => (
                <VideoCard key={v.video_id} video={v} />
              ))}
            </div>
          )}
        </div>

        <div className="px-4 py-2.5 border-t border-gray-200 dark:border-gray-700 text-right">
          <a
            href={channelUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-semibold text-blue-600 dark:text-blue-400 hover:underline"
          >
            {channelName} 채널 바로가기 ↗
          </a>
        </div>
      </div>
    </div>
  );
}
