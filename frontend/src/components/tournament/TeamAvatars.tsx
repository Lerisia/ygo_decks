import Avatar from "@/components/Avatar";
import type { TeamMember } from "@/api/tournamentApi";

/** Overlapping member avatars for a team, captain first. */
export default function TeamAvatars({ members, size = 24, max = 5 }: { members: Pick<TeamMember, "id" | "name" | "avatar_icon" | "border" | "is_captain">[]; size?: number; max?: number }) {
  const ordered = [...members].sort((a, b) => Number(b.is_captain) - Number(a.is_captain));
  return (
    <div className="flex items-center shrink-0" style={{ paddingLeft: size * 0.3 }}>
      {ordered.slice(0, max).map((m) => (
        <div key={m.id} title={m.name} style={{ marginLeft: -size * 0.3 }}>
          <Avatar icon={m.avatar_icon} border={m.border} size={size} />
        </div>
      ))}
      {ordered.length > max && <span className="ml-1 text-[10px] text-gray-400">+{ordered.length - max}</span>}
    </div>
  );
}
