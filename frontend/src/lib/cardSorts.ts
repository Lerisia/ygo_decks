/** The card book's sorts: Master Duel's, each either way (엘리스 10/12), under its names; 디폴트 순: each monster frame
 *  before its pendulum, low levels first, then spells and traps. Kept here so the analytics page can name them too. */
export const CARD_SORTS = [
  { value: "new", label: "최신 카드순" },
  { value: "type", label: "디폴트 순" },
  { value: "name", label: "이름순" },
  { value: "rarity", label: "레어리티" },
  { value: "level", label: "레벨 / 랭크 / 링크" },
  { value: "atk", label: "공격력" },
  { value: "def", label: "수비력" },
];
