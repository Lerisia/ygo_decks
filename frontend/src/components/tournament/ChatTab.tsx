import { useEffect, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import { getChat, postChat, type ChatMessage } from "@/api/tournamentApi";

const POLL_MS = 5000;

export default function ChatTab({ tournamentId, canWrite }: { tournamentId: number; canWrite: boolean }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const lastId = useRef<number>(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  const pull = async () => {
    try {
      const fresh = await getChat(tournamentId, lastId.current || undefined);
      if (fresh.length) {
        lastId.current = fresh[fresh.length - 1].id;
        setMessages((prev) => [...prev, ...fresh]);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "채팅을 불러오지 못했습니다."); }
  };

  useEffect(() => {
    lastId.current = 0; setMessages([]);
    pull();
    const id = setInterval(pull, POLL_MS);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentId]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ block: "nearest" }); }, [messages.length]);

  const send = async () => {
    const content = text.trim();
    if (!content) return;
    setText(""); setError("");
    try { await postChat(tournamentId, content); await pull(); }
    catch (e) { setError(e instanceof Error ? e.message : "전송 실패"); setText(content); }
  };

  return (
    <div className="flex flex-col" style={{ height: 420 }}>
      <div className="flex-1 overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 space-y-2">
        {messages.length === 0 && <p className="text-sm text-gray-500 dark:text-gray-400">아직 메시지가 없습니다.</p>}
        {messages.map((m) => (
          <div key={m.id} className="flex items-start gap-2">
            <Avatar icon={m.avatar_icon} border={m.border} size={28} className="shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-xs text-gray-500 dark:text-gray-400">
                <span className="font-semibold text-gray-700 dark:text-gray-200">{m.username}</span>
                <span className="ml-1">{new Date(m.created_at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</span>
              </div>
              <p className="text-sm break-words whitespace-pre-wrap">{m.content}</p>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
      {canWrite ? (
        <div className="flex gap-2 mt-2">
          <input
            className="flex-1 px-3 py-2 text-sm border rounded-lg bg-white dark:bg-gray-800 dark:text-white"
            placeholder="메시지 (최대 500자)" maxLength={500} value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) send(); }}
          />
          <button className="shrink-0 whitespace-nowrap px-4 py-2 text-sm rounded-lg font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50" disabled={!text.trim()} onClick={send}>전송</button>
        </div>
      ) : (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">참가자와 주최자만 채팅할 수 있습니다.</p>
      )}
    </div>
  );
}
