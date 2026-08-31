import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createTournament, type TournamentFormat } from "@/api/tournamentApi";

const inputCls = "w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-black dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";

function CreateTournament() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [format, setFormat] = useState<TournamentFormat>("swiss");
  const [capacity, setCapacity] = useState("8");
  const [eventDate, setEventDate] = useState("");
  const [swissRounds, setSwissRounds] = useState("");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError("");
    if (!name.trim() || !eventDate) {
      setError("대회 이름과 일시는 필수입니다.");
      return;
    }
    const cap = Number(capacity);
    if (!Number.isInteger(cap) || cap < 2 || cap > 128) {
      setError("정원은 2~128명 사이여야 합니다.");
      return;
    }
    setBusy(true);
    try {
      const config: Record<string, unknown> = {};
      if (format === "swiss" && swissRounds.trim()) config.swiss_rounds = Number(swissRounds);
      const t = await createTournament({
        name: name.trim(),
        description: description.trim(),
        format,
        capacity: cap,
        event_date: new Date(eventDate).toISOString(),
        format_config: config,
      }, coverFile);
      navigate(`/tournaments/${t.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "생성에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-4 py-6 min-h-screen max-w-lg mx-auto">
      <button onClick={() => navigate("/tournaments")} className="text-sm text-gray-500 dark:text-gray-400 hover:text-blue-600 mb-2">← 대회 목록</button>
      <h1 className="text-2xl font-bold mb-4">대회 생성</h1>
      <div className="flex flex-col gap-3">
        <div>
          <label className="block text-sm font-semibold mb-1">대회 이름 *</label>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="제1회 OO컵" />
        </div>
        <div>
          <label className="block text-sm font-semibold mb-1">설명</label>
          <textarea className={inputCls} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="규칙, 밴리스트, 디스코드 링크 등" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-semibold mb-1">형식 *</label>
            <select className={inputCls} value={format} onChange={(e) => setFormat(e.target.value as TournamentFormat)}>
              <option value="swiss">스위스</option>
              <option value="single_elim">싱글 엘리미네이션</option>
              <option value="round_robin">라운드 로빈</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">정원 *</label>
            <input type="number" min={2} max={128} className={inputCls} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
          </div>
        </div>
        {format === "swiss" && (
          <div>
            <label className="block text-sm font-semibold mb-1">스위스 라운드 수 (비우면 자동)</label>
            <input type="number" min={1} max={20} className={inputCls} value={swissRounds} onChange={(e) => setSwissRounds(e.target.value)} placeholder="예: 4" />
          </div>
        )}
        <div>
          <label className="block text-sm font-semibold mb-1">대회 배너 (선택)</label>
          <input
            type="file"
            accept="image/*"
            className="block w-full text-sm text-gray-600 dark:text-gray-300"
            onChange={(e) => setCoverFile(e.target.files?.[0] ?? null)}
          />
          {coverFile && (
            <img src={URL.createObjectURL(coverFile)} alt="배너 미리보기" className="mt-2 w-full h-40 object-cover rounded-lg" />
          )}
        </div>
        <div>
          <label className="block text-sm font-semibold mb-1">일시 *</label>
          <input type="datetime-local" className={inputCls} value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <button
          onClick={submit}
          disabled={busy}
          className="mt-2 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
        >
          {busy ? "생성 중..." : "대회 만들기"}
        </button>
      </div>
    </div>
  );
}

export default CreateTournament;
