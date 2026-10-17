import Avatar from "@/components/Avatar";
import type { DeckListAuthor } from "@/api/deckListApi";

/** Who posted a deck list or a comment: their icon in its frame and their name, always together. */
export default function DeckAuthor({ author, size = 24, className = "" }: { author: DeckListAuthor; size?: number; className?: string }) {
  return (
    <span className={`min-w-0 inline-flex items-center gap-1.5 ${className}`}>
      <Avatar icon={author.avatar_icon} border={author.border} size={size} className="shrink-0" />
      <span className="min-w-0 truncate font-semibold">{author.name}</span>
    </span>
  );
}
