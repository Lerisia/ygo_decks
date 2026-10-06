import { Link } from "react-router-dom";
import { BOARD_INFO, type InquiryBoard } from "@/api/inquiryApi";

// 문의하기: the two boards (특이점 2026-10-07). Replaces the open-chat link behind every 문의 button.
const BOARDS: InquiryBoard[] = ["deck", "site"];

export default function InquiryHome() {
  return (
    <div className="min-h-screen px-4 sm:px-6 py-6 w-full lg:w-[88%] mx-auto text-gray-900 dark:text-white">
      {/* Board pages take about 88% of the site's width on PC (특이점 2026-10-07: max-w-2xl looked too narrow). */}
      <h1 className="text-2xl md:text-3xl font-bold">문의하기</h1>
      <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
        제보와 문의는 게시판에 남겨 주세요. 운영진이 확인하고 답변을 달아 드립니다.
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {BOARDS.map((b) => (
          <Link
            key={b}
            to={`/inquiry/${b}`}
            className="group flex flex-col gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 hover:border-blue-400 dark:hover:border-blue-500 transition"
          >
            <span className="text-3xl" aria-hidden="true">{BOARD_INFO[b].icon}</span>
            <span className="text-lg font-bold text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400">
              {BOARD_INFO[b].title}
            </span>
            <span className="text-sm text-gray-600 dark:text-gray-400">{BOARD_INFO[b].desc}</span>
          </Link>
        ))}
      </div>

      <ul className="mt-6 text-sm text-gray-500 dark:text-gray-400 list-disc pl-5 space-y-1">
        <li>글쓴이는 모두 <b className="text-gray-700 dark:text-gray-300">익명</b>으로 표시됩니다.</li>
        <li>비공개로 쓴 글은 🔒 표시가 붙고, 글쓴이와 운영진만 내용을 볼 수 있습니다.</li>
        <li>답변은 운영진만 달 수 있습니다. 원하면 답변이 달릴 때 메일로 알려 드립니다.</li>
      </ul>
    </div>
  );
}
