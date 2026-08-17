import { useEffect, useMemo, useRef, useState } from "react";

interface Props {
  value: string;
  onChange: (hex: string) => void;
  onClose: () => void;
  /** Set when the picker is rendered inside a CSS-rotated parent
   *  (mobile drawer-focus / MLD mode rotates content 90° CW). Without
   *  this, pointer events get the screen-frame coordinates and the wheel
   *  reads them as the canvas's local frame — drag direction inverts. */
  rotated?: boolean;
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = v - c;
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => n.toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const m = hex.replace("#", "");
  if (m.length !== 6) return { h: 0, s: 0, v: 0 };
  const r = parseInt(m.slice(0, 2), 16) / 255;
  const g = parseInt(m.slice(2, 4), 16) / 255;
  const b = parseInt(m.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  const v = max;
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s, v };
}

const SIZE = 240;

export default function ColorWheelPicker({ value, onChange, onClose, rotated }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const initHsv = useMemo(() => hexToHsv(value), []);
  const [h, setH] = useState(initHsv.h);
  const [s, setS] = useState(initHsv.s);
  const [v, setV] = useState(initHsv.v || 1);
  // Ghost-click guard — on mobile, the tap that opens this picker often
  // bubbles up a synthesized click on the freshly mounted backdrop,
  // which would close it instantly ("띱 띱" flicker users reported).
  // Ignore backdrop closes for the first 350ms after mount.
  const mountedAt = useRef(Date.now());
  const safeClose = () => {
    if (Date.now() - mountedAt.current < 350) return;
    onClose();
  };

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const r = SIZE / 2;
    const img = ctx.createImageData(SIZE, SIZE);
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const dx = x - r;
        const dy = y - r;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const i = (y * SIZE + x) * 4;
        if (dist > r) {
          img.data[i + 3] = 0;
          continue;
        }
        const hue = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
        const sat = Math.min(1, dist / r);
        const [rr, gg, bb] = hsvToRgb(hue, sat, v);
        img.data[i] = rr;
        img.data[i + 1] = gg;
        img.data[i + 2] = bb;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [v]);

  const dragging = useRef(false);
  const pick = (clientX: number, clientY: number) => {
    const cv = canvasRef.current;
    if (!cv) return;
    const rect = cv.getBoundingClientRect();
    const scale = SIZE / rect.width;
    // When the picker lives inside a 90° CW rotated parent (MLD), the
    // canvas's BCR is the post-transform AABB — screen X corresponds to
    // the canvas's local -Y and screen Y to canvas's local X. Un-rotate
    // here so a finger drag mirrors the visual wheel direction.
    const x = rotated
      ? (clientY - rect.top) * scale
      : (clientX - rect.left) * scale;
    const y = rotated
      ? (rect.right - clientX) * scale
      : (clientY - rect.top) * scale;
    const r = SIZE / 2;
    const dx = x - r;
    const dy = y - r;
    const hue = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
    const sat = Math.min(1, Math.sqrt(dx * dx + dy * dy) / r);
    setH(hue);
    setS(sat);
    const [rr, gg, bb] = hsvToRgb(hue, sat, v);
    onChange(rgbToHex(rr, gg, bb));
  };

  const onValueChange = (newV: number) => {
    setV(newV);
    const [rr, gg, bb] = hsvToRgb(h, s, newV);
    onChange(rgbToHex(rr, gg, bb));
  };

  const markerR = (s * SIZE) / 2;
  const markerAngle = (h * Math.PI) / 180;
  const markerX = SIZE / 2 + markerR * Math.cos(markerAngle);
  const markerY = SIZE / 2 + markerR * Math.sin(markerAngle);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={safeClose}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-xl max-w-xs w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative mx-auto" style={{ width: SIZE, height: SIZE, maxWidth: "100%" }}>
          <canvas
            ref={canvasRef}
            width={SIZE}
            height={SIZE}
            style={{
              touchAction: "none",
              cursor: "crosshair",
              borderRadius: "50%",
              width: "100%",
              height: "auto",
              display: "block",
            }}
            onPointerDown={(e) => {
              dragging.current = true;
              try { (e.target as HTMLElement).setPointerCapture(e.pointerId); } catch {}
              pick(e.clientX, e.clientY);
            }}
            onPointerMove={(e) => { if (dragging.current) pick(e.clientX, e.clientY); }}
            onPointerUp={(e) => {
              dragging.current = false;
              try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
            }}
            onPointerCancel={() => { dragging.current = false; }}
          />
          <div
            className="absolute pointer-events-none border-2 border-white rounded-full"
            style={{
              width: 14, height: 14,
              left: `calc(${(markerX / SIZE) * 100}% - 7px)`,
              top: `calc(${(markerY / SIZE) * 100}% - 7px)`,
              boxShadow: "0 0 0 1.5px rgba(0,0,0,0.75)",
            }}
          />
        </div>
        {/* Slider thumb sizing — default browser thumb is tiny (~12px)
            and hard to grab on phones. Bump to 28px via vendor prefixes
            for WebKit/Gecko/Edge so the touch hitbox is finger-sized. */}
        <style>{`
          .cwp-brightness-slider { -webkit-appearance: none; appearance: none; height: 36px; background: transparent; }
          .cwp-brightness-slider:focus { outline: none; }
          .cwp-brightness-slider::-webkit-slider-runnable-track { height: 10px; border-radius: 9999px; background: linear-gradient(to right, #000, currentColor); }
          .cwp-brightness-slider::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 28px; height: 28px; border-radius: 9999px; background: #fff; border: 2px solid #3b82f6; box-shadow: 0 0 0 1px rgba(0,0,0,0.4); margin-top: -9px; cursor: pointer; }
          .cwp-brightness-slider::-moz-range-track { height: 10px; border-radius: 9999px; background: linear-gradient(to right, #000, currentColor); }
          .cwp-brightness-slider::-moz-range-thumb { width: 28px; height: 28px; border-radius: 9999px; background: #fff; border: 2px solid #3b82f6; box-shadow: 0 0 0 1px rgba(0,0,0,0.4); cursor: pointer; }
        `}</style>
        <div className="mt-4 flex items-center gap-2">
          <span className="text-xs w-10 text-gray-700 dark:text-gray-300 shrink-0">밝기</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(v * 100)}
            onChange={(e) => onValueChange(parseInt(e.target.value, 10) / 100)}
            className="cwp-brightness-slider flex-1"
            style={{ touchAction: "manipulation" }}
          />
          <div
            className="w-8 h-8 rounded border border-gray-300 dark:border-gray-600 shrink-0"
            style={{ background: value }}
            title={value}
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
