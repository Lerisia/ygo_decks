import { useState } from 'react';

interface Participant {
  name: string;
}

export default function BracketPage() {
  const [bracketName, setBracketName] = useState('');
  const [type, setType] = useState<'swiss' | 'single_elim'>('swiss');
  const [participants, setParticipants] = useState<Participant[]>([{ name: '' }, { name: '' }]);
  const [bracketId, setBracketId] = useState<number | null>(null);
  const [pairings, setPairings] = useState<{ player1: string; player2: string; matchId?: number; result?: string }[]>([]);

  const handleParticipantChange = (index: number, value: string) => {
    const updated = [...participants];
    updated[index].name = value;
    setParticipants(updated);
  };

  const addParticipant = () => {
    setParticipants([...participants, { name: '' }]);
  };

  const createBracket = async () => {
    const names = participants.map((p) => p.name).filter((n) => n.trim() !== '');
    const res = await fetch('/api/brackets/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: bracketName, type, participants: names })
    });
    const data = await res.json();
    setBracketId(data.bracket_id);
    generatePairings(data.bracket_id);
  };

  const generatePairings = async (id: number) => {
    const res = await fetch(`/api/brackets/${id}/pairings/next/`);
    const data = await res.json();
    setPairings(data.pairings.map((p: any, index: number) => ({ ...p, matchId: index })));
  };

  const submitResult = async (matchId: number, result: string) => {
    const match = pairings[matchId];
    const res = await fetch(`/api/brackets/${bracketId}/match-result/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ match_id: match.matchId, result })
    });
    if (res.ok) {
      const updated = [...pairings];
      updated[matchId].result = result;
      setPairings(updated);
    }
  };

  const allMatchesResolved = pairings.every((m) => m.result);

  return (
    <div className="max-w-xl mx-auto p-4 space-y-6">
      {!bracketId ? (
        <div className="space-y-4">
          <input
            className="w-full border p-2 rounded"
            placeholder="Bracket name"
            value={bracketName}
            onChange={(e) => setBracketName(e.target.value)}
          />
          <select className="w-full border p-2 rounded" value={type} onChange={(e) => setType(e.target.value as any)}>
            <option value="swiss">Swiss</option>
            <option value="single_elim">Single Elimination</option>
          </select>
          <div className="space-y-2">
            {participants.map((p, i) => (
              <input
                key={i}
                className="w-full border p-2 rounded"
                placeholder={`Participant ${i + 1}`}
                value={p.name}
                onChange={(e) => handleParticipantChange(i, e.target.value)}
              />
            ))}
            <button className="text-blue-500 underline" onClick={addParticipant}>+ Add participant</button>
          </div>
          <button className="w-full bg-blue-500 text-white py-2 rounded" onClick={createBracket}>
            Create Bracket
          </button>
        </div>
      ) : (
        <div>
          <h2 className="text-xl font-bold mb-4">Current Round</h2>
          {pairings.map((m, i) => (
            <div key={i} className="flex justify-between items-center border p-2 rounded mb-2">
              <span>{m.player1} vs {m.player2}</span>
              {m.result ? (
                <span className="text-green-600 font-semibold">{m.result} 승</span>
              ) : (
                <div className="space-x-2">
                  <button className="px-2 py-1 bg-green-500 text-white rounded" onClick={() => submitResult(i, 'P1')}> {m.player1} 승</button>
                  <button className="px-2 py-1 bg-blue-500 text-white rounded" onClick={() => submitResult(i, 'P2')}> {m.player2} 승</button>
                  <button className="px-2 py-1 bg-gray-500 text-white rounded" onClick={() => submitResult(i, 'DRAW')}>무승부</button>
                </div>
              )}
            </div>
          ))}
          {allMatchesResolved && (
            <button className="w-full bg-purple-600 text-white py-2 rounded mt-4" onClick={() => generatePairings(bracketId!)}>
              다음 라운드 시작
            </button>
          )}
        </div>
      )}
    </div>
  );
}
