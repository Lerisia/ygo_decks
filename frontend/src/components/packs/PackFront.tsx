/** A pack's front, the game's own picture; a pack the game client no longer holds a picture of (the 2022 selection
 *  packs) gets a plain gold one with its name. */
export default function PackFront({ name, src, className = "", eager = false }: {
  name: string; src: string | null; className?: string; eager?: boolean;
}) {
  if (src) {
    return <img loading={eager ? "eager" : "lazy"} decoding="async" src={src} alt={`${name} 팩`} className={`aspect-[250/512] object-cover ${className}`} />;
  }
  return (
    <div role="img" aria-label={`${name} 팩`} className={`aspect-[250/512] flex items-center justify-center p-2 bg-gradient-to-b from-amber-200 via-amber-500 to-amber-800 ${className}`}>
      <span className="text-center text-white text-xs sm:text-sm font-extrabold break-keep drop-shadow">{name}</span>
    </div>
  );
}
