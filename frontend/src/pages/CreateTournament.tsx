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
  const [cut, setCut] = useState(4);
  const [groups, setGroups] = useState(2);
  const [advance, setAdvance] = useState(2);
  const [teamSize, setTeamSize] = useState(1);
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
      if ((format === "swiss" || format === "swiss_cut") && swissRounds.trim()) config.swiss_rounds = Number(swissRounds);
      if (format === "swiss_cut") config.cut = cut;
      if (format === "group_knockout") { config.groups = groups; config.advance = advance; }
      const t = await createTournament({
        name: name.trim(),
        description: description.trim(),
        format,
        capacity: cap,
        team_size: teamSize,
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
              <option value="swiss_cut">스위스 + 결선 토너먼트</option>
              <option value="group_knockout">조별 리그 + 결선 토너먼트</option>
              <option value="double_elim">더블 엘리미네이션</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">정원 * {teamSize > 1 && <span className="font-normal text-gray-500">(팀 수)</span>}</label>
            <input type="number" min={2} max={128} className={inputCls} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="block text-sm font-semibold mb-1">참가 단위</label>
          <select className={inputCls} value={teamSize} onChange={(e) => setTeamSize(Number(e.target.value))}>
            <option value={1}>개인전</option>
            {[2, 3, 4, 5].map((n) => <option key={n} value={n}>팀전 · {n}인 1팀</option>)}
          </select>
          {teamSize > 1 && (
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              팀장이 팀을 만들고 팀 코드를 공유하면 팀원이 합류합니다. 팀 경기는 {teamSize}개 개인전으로 치러지고 더 많이 이긴 팀이 승리합니다.
              {teamSize % 2 === 0 && " 인원이 짝수라 동률이 날 수 있습니다. 동률은 리그·스위스에서는 무승부, 결선에서는 주최자가 판정합니다."}
            </p>
          )}
        </div>
        {(format === "swiss" || format === "swiss_cut") && (
          <div>
            <label className="block text-sm font-semibold mb-1">스위스 라운드 수 (비우면 자동)</label>
            <input type="number" min={1} max={20} className={inputCls} value={swissRounds} onChange={(e) => setSwissRounds(e.target.value)} placeholder="예: 4" />
          </div>
        )}
        {format === "swiss_cut" && (
          <div>
            <label className="block text-sm font-semibold mb-1">결선 진출 인원</label>
            <select className={inputCls} value={cut} onChange={(e) => setCut(Number(e.target.value))}>
              {[2, 4, 8, 16].map((n) => <option key={n} value={n}>{n}명</option>)}
            </select>
          </div>
        )}
        {format === "group_knockout" && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold mb-1">조 수</label>
              <select className={inputCls} value={groups} onChange={(e) => setGroups(Number(e.target.value))}>
                {[2, 4, 8].map((n) => <option key={n} value={n}>{n}개 조</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">조당 결선 진출</label>
              <select className={inputCls} value={advance} onChange={(e) => setAdvance(Number(e.target.value))}>
                {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}명</option>)}
              </select>
            </div>
            <p className="col-span-2 text-xs text-gray-500 dark:text-gray-400">
              참가자를 무작위로 {groups}개 조에 나눠 조별 라운드 로빈을 치른 뒤, 각 조 상위 {advance}명({groups * advance}명)이 결선 토너먼트로 갑니다. 조당 2명 이상이어야 시작할 수 있습니다.
            </p>
          </div>
        )}
        {format === "double_elim" && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            승자조에서 지면 패자조로 내려가고, 두 번 지면 탈락합니다. 최종전은 승자조 우승자 대 패자조 우승자이며, 패자조 우승자가 이기면 한 번 더 겨룹니다.
          </p>
        )}
        <div>
          <label className="block text-sm font-semibold mb-1">대회 배너 (선택)</label>
          <input
            type="file"
            accept="image/*"
            className="block w-full text-sm text-gray-600 dark:text-gray-300"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              if (f && f.size > 5 * 1024 * 1024) {
                setError("배너 이미지는 5MB 이하여야 합니다.");
                e.target.value = "";
                return;
              }
              setError("");
              setCoverFile(f);
            }}
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
