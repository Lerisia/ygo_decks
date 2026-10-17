import Avatar, { type AvatarIcon } from "@/components/Avatar";
import type { Border } from "@/api/avatarApi";

/** A member as the server shows them beside what they wrote (board.api.author_of): name, icon, frame and role. */
export type UserRef = { name: string; avatar_icon: AvatarIcon | null; border: Border | null; role?: "staff" | "editor" | null };

const ROLE = {
  staff: { label: "운영자", className: "bg-blue-600 text-white" },
  editor: { label: "에디터", className: "bg-emerald-600 text-white" },
} as const;

/** The chip before an operator's or editor's name (엘리스 2026-10-18: "운영자 ㅇㅇㅇ, 에디터 ㅁㅁㅁ", as a chip so it never
 *  reads as part of the name). */
export function RoleChip({ role, className = "" }: { role: UserRef["role"]; className?: string }) {
  if (!role) return null;
  const r = ROLE[role];
  // sized in em, so the chip grows with the text it stands in (엘리스 2026-10-18: too small beside a notice)
  return <span className={`shrink-0 inline-flex items-center h-[1.5em] px-[0.5em] rounded text-[0.8em] font-bold leading-none ${r.className} ${className}`}>{r.label}</span>;
}

/** Who wrote something: their icon in its frame, their role's chip, and their name — always together, wherever a
 *  name is shown (deck lists and their comments, notices, inquiry answers). */
export default function UserName({ user, size = 24, className = "" }: { user: UserRef; size?: number; className?: string }) {
  return (
    <span className={`min-w-0 inline-flex items-center gap-1.5 ${className}`}>
      <Avatar icon={user.avatar_icon} border={user.border} size={size} className="shrink-0" />
      <RoleChip role={user.role} />
      <span className="min-w-0 truncate font-semibold">{user.name}</span>
    </span>
  );
}
