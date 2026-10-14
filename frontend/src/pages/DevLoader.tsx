import { useState } from "react";
import LogoLoader from "@/components/LogoLoader";
import { useAdminOnly } from "@/hooks/useAdminOnly";

function Slider({ label, value, min, max, step, unit, onChange }: {
  label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-3 text-sm">
      <span className="w-28 shrink-0 text-gray-600 dark:text-gray-300">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="flex-1" />
      <span className="w-20 shrink-0 text-right tabular-nums">{value}{unit}</span>
    </label>
  );
}

/** /dev/loader (operators only): the logo shuffle loader to tune before it goes anywhere (참혈 2026-10-14). */
export default function DevLoader() {
  const admin = useAdminOnly();
  const [size, setSize] = useState(160);
  const [shuffleMs, setShuffleMs] = useState(600);
  const [pauseMs, setPauseMs] = useState(700);
  const [shuffles, setShuffles] = useState(3);
  const [swap, setSwap] = useState(true);
  if (!admin) return <div className="min-h-screen" />;
  const props = { shuffleMs, pauseMs, shuffles, swap };
  // a new key when a setting changes, so the loop starts again from the first shuffle
  const key = `${shuffleMs}-${pauseMs}-${shuffles}-${swap}`;

  return (
    <div className="min-h-screen w-full max-w-4xl mx-auto px-4 py-6">
      <h1 className="text-xl font-bold">로딩 스피너 시험</h1>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 break-keep">
        카드가 갈라질 때는 왼쪽이 아래, 닫히기 시작하면 왼쪽이 위로 올라옵니다. {shuffles}번 섞은 뒤 잠깐 쉽니다. 움직임 줄이기를 켠 기기에서는 멈춘 채 깜빡입니다.
      </p>
      <div className="mt-4 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex flex-col gap-2.5">
        <Slider label="크기" value={size} min={24} max={320} step={4} unit="px" onChange={setSize} />
        <Slider label="한 번 섞는 시간" value={shuffleMs} min={300} max={2000} step={50} unit="ms" onChange={setShuffleMs} />
        <Slider label="쉬는 시간" value={pauseMs} min={0} max={3000} step={100} unit="ms" onChange={setPauseMs} />
        <Slider label="섞는 횟수" value={shuffles} min={1} max={5} step={1} unit="번" onChange={setShuffles} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={swap} onChange={(e) => setSwap(e.target.checked)} />
          닫힐 때 앞뒤 바꾸기
        </label>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl bg-white border border-gray-200 min-h-80 grid place-items-center p-4">
          <LogoLoader key={`light-${key}`} size={size} {...props} className="!filter-none" />
        </div>
        <div className="rounded-xl bg-gray-900 border border-gray-700 min-h-80 grid place-items-center p-4">
          <LogoLoader key={`dark-${key}`} size={size} {...props} className="invert" />
        </div>
      </div>
      <div className="mt-4 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex items-end gap-6 flex-wrap">
        {[24, 32, 48, 64, 96].map((s) => (
          <div key={s} className="flex flex-col items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
            <LogoLoader key={`${s}-${key}`} size={s} {...props} />
            {s}px
          </div>
        ))}
        <span className="flex items-center gap-2 text-sm">
          <LogoLoader key={`inline-${key}`} size={22} {...props} /> 불러오는 중…
        </span>
      </div>
    </div>
  );
}
