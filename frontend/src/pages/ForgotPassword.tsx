import { useState } from "react";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!email) return;
    setLoading(true);
    setMessage("");

    const res = await fetch("/api/password-reset/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

    const data = await res.json();
    setMessage(data.message);
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex flex-col items-center px-4 pt-10">
      <h1 className="text-2xl font-bold mb-2">비밀번호 찾기</h1>
      <p className="text-gray-500 dark:text-gray-400 mb-6 text-center">
        가입한 이메일을 입력하면 재설정 링크를 보내드립니다.
      </p>

      <form className="w-80 space-y-4" onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
        <input
          type="email"
          placeholder="이메일 주소"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full px-3 py-2 border rounded-lg bg-white text-black dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="submit"
          disabled={!email || loading}
          className={`w-full py-2 rounded-lg font-semibold transition ${
            !email || loading
              ? "bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-not-allowed"
              : "bg-blue-600 hover:bg-blue-700 text-white"
          }`}
        >
          {loading ? "발송 중..." : "재설정 링크 발송"}
        </button>
        {message && (
          <p className="text-center text-sm text-green-600 dark:text-green-400">{message}</p>
        )}
      </form>
    </div>
  );
}
