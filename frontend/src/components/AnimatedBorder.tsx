type AnimatedBorderType =
  | "fire" | "water" | "wind" | "earth" | "light" | "dark"
  | "labrynth"
  | "melodious"
  | "skystriker"
  | "spring";

interface Props {
  type: AnimatedBorderType;
  size: number;
}

const THEMES: Record<string, string[]> = {
  fire:     ["#7a0000", "#ff4400", "#ffaa00", "#ff4400", "#7a0000"],
  water:    ["#0c4a8a", "#3b82f6", "#a8dcff", "#3b82f6", "#0c4a8a"],
  wind:     ["#065f46", "#10b981", "#a7f3d0", "#10b981", "#065f46"],
  earth:    ["#3a230a", "#a16f3d", "#e8c896", "#a16f3d", "#3a230a"],
  light:    ["#b8860b", "#fde047", "#fffbe6", "#fde047", "#b8860b"],
  dark:     ["#1e1b4b", "#6d28d9", "#c084fc", "#6d28d9", "#1e1b4b"],
  labrynth: ["#b8b4c4", "#d4d0dc", "#ebe8f0", "#d4d0dc", "#b8b4c4"],
  // 봄 — 분홍 단색
  spring: ["#f9a8c8", "#fbc3d6", "#fde0e9", "#fbc3d6", "#f9a8c8"],
};

const ROTATING: Set<string> = new Set(["fire", "water", "wind", "earth", "light", "dark"]);
const SPARKLE: Set<string> = new Set(["labrynth", "spring"]);

const RING_OUTER = 50;
const RING_INNER = 45;

const SPARKLE_POSITIONS: Array<{ angle: number; r: number; delay: number; size: number }> = [
  { angle: 30,  r: 47.5, delay: 0,   size: 1.6 },
  { angle: 95,  r: 47.5, delay: 0.6, size: 1.2 },
  { angle: 160, r: 47.5, delay: 1.2, size: 1.8 },
  { angle: 220, r: 47.5, delay: 0.3, size: 1.4 },
  { angle: 280, r: 47.5, delay: 0.9, size: 1.6 },
  { angle: 340, r: 47.5, delay: 1.5, size: 1.2 },
];

export default function AnimatedBorder({ type, size }: Props) {
  if (type === "melodious") return <MelodiousOverlay size={size} />;
  if (type === "skystriker") return <SkyStrikerOverlay size={size} />;

  const stops = THEMES[type] || THEMES.fire;
  const gradId = `border-grad-${type}`;
  const maskId = `border-mask-${type}`;
  const rotates = ROTATING.has(type);
  const hasSparkle = SPARKLE.has(type);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    >
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
          {stops.map((color, i) => (
            <stop key={i} offset={`${(i / (stops.length - 1)) * 100}%`} stopColor={color} />
          ))}
        </linearGradient>
        <mask id={maskId}>
          <rect width="100" height="100" fill="black" />
          <circle cx="50" cy="50" r={RING_OUTER} fill="white" />
          <circle cx="50" cy="50" r={RING_INNER} fill="black" />
        </mask>
      </defs>
      <g mask={`url(#${maskId})`}>
        <rect width="100" height="100" fill={`url(#${gradId})`}>
          {rotates && (
            <animateTransform
              attributeName="transform"
              type="rotate"
              from="0 50 50"
              to="360 50 50"
              dur="6s"
              repeatCount="indefinite"
            />
          )}
        </rect>
      </g>
      {hasSparkle && (
        <g>
          {SPARKLE_POSITIONS.map((s, i) => {
            const rad = (s.angle * Math.PI) / 180;
            const cx = 50 + s.r * Math.cos(rad);
            const cy = 50 + s.r * Math.sin(rad);
            return (
              <circle key={i} cx={cx} cy={cy} r={s.size} fill="#ffffff" opacity="0">
                <animate
                  attributeName="opacity"
                  values="0;1;0"
                  dur="1.8s"
                  begin={`${s.delay}s`}
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="r"
                  values={`${s.size * 0.6};${s.size * 1.4};${s.size * 0.6}`}
                  dur="1.8s"
                  begin={`${s.delay}s`}
                  repeatCount="indefinite"
                />
              </circle>
            );
          })}
        </g>
      )}
    </svg>
  );
}

// ─────── 환주 오버레이 ───────
// 아이콘 외곽을 따라 5줄의 동심원 오선지 + 그 위에 정방향 음표
function MelodiousOverlay({ size }: { size: number }) {
  // 5줄 동심원 오선 — 아이콘 안(r<45)과 밖(r>45)을 모두 걸치게
  const staffRadii = [38, 41, 44, 47, 50];
  const middleR = 44;

  // 정방향 음표 6개 — 회전 없이 정방향으로 배치
  const notes = [
    { sym: "♪", angle: -90, delay: 0 },
    { sym: "♫", angle: -30, delay: 0.3 },
    { sym: "♩", angle: 30,  delay: 0.6 },
    { sym: "♬", angle: 90,  delay: 0.9 },
    { sym: "♪", angle: 150, delay: 1.2 },
    { sym: "♫", angle: 210, delay: 1.5 },
  ];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    >
      {/* 동심원 오선 5줄 */}
      {staffRadii.map((r, i) => (
        <circle
          key={i}
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="#5a3a1a"
          strokeWidth="0.9"
          opacity="0.9"
        />
      ))}

      {/* 정방향 음표 */}
      {notes.map((n, i) => {
        const rad = (n.angle * Math.PI) / 180;
        const cx = 50 + middleR * Math.cos(rad);
        const cy = 50 + middleR * Math.sin(rad);
        return (
          <text
            key={i}
            x={cx}
            y={cy}
            fontSize="24"
            textAnchor="middle"
            dominantBaseline="central"
            fill="#3a1f08"
            fontFamily="serif"
            stroke="#fff5e6"
            strokeWidth="0.6"
            paintOrder="stroke"
          >
            {n.sym}
            <animate
              attributeName="opacity"
              values="0.7;1;0.7"
              dur="1.8s"
              begin={`${n.delay}s`}
              repeatCount="indefinite"
            />
          </text>
        );
      })}
    </svg>
  );
}

// ─────── 섬도희 오버레이 (스텁 — 다음 단계에서 디테일 작업) ───────
function SkyStrikerOverlay({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    >
      {/* 임시: 6각형 외곽선 */}
      <polygon
        points="50,5 90,27.5 90,72.5 50,95 10,72.5 10,27.5"
        fill="none"
        stroke="#06b6d4"
        strokeWidth="1.5"
        opacity="0.85"
      />
    </svg>
  );
}

