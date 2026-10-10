import { Link } from "react-router-dom";

// Entry to tournaments (hidden from menus until the feature opens, 특이점 2026-10-10): host one, or join one.
const CHOICES = [
  { to: "/tournaments/create", icon: "🏆", title: "대회를 개최하기", desc: "이름·인원·일시·참가 비밀번호를 정해 대회를 엽니다." },
  { to: "/tournaments/join", icon: "🙋", title: "참여자로 참가하기", desc: "모집 중인 대회를 찾아 참가 신청합니다." },
];

export default function TournamentHub() {
  const loggedIn = !!localStorage.getItem("access_token");
  return (
    <div className="px-4 py-6 min-h-screen max-w-2xl mx-auto text-gray-900 dark:text-white">
      <h1 className="text-2xl md:text-3xl font-bold mb-5">대회</h1>
      {!loggedIn ? (
        <p className="text-sm text-gray-600 dark:text-gray-400">
          대회는 로그인한 회원만 이용할 수 있습니다.{" "}
          <Link to="/login" className="text-blue-600 dark:text-blue-400 hover:underline">로그인하기 →</Link>
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {CHOICES.map((c) => (
            <Link
              key={c.to}
              to={c.to}
              className="flex flex-col gap-2 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 hover:border-blue-400 hover:shadow-md transition"
            >
              <span className="text-3xl" aria-hidden="true">{c.icon}</span>
              <span className="text-lg font-bold">{c.title}</span>
              <span className="text-sm text-gray-500 dark:text-gray-400">{c.desc}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
