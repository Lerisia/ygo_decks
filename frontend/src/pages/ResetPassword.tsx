import { useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const uid = searchParams.get("uid");
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (!uid || !token) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-red-500">유효하지 않은 링크입니다.</p>
      </div>
    );
  }

  const handleSubmit = async () => {
    if (password !== confirmPassword) {
      setError("비밀번호가 일치하지 않습니다.");
      return;
    }
    if (password.length < 6) {
      setError("비밀번호는 6자 이상이어야 합니다.");
      return;
    }

    setLoading(true);
    setError("");
    setMessage("");

    const res = await fetch("/api/password-reset/confirm/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid, token, new_password: password }),
    });

    const data = await res.json();

    if (res.ok) {
      setMessage("비밀번호가 변경되었습니다. 로그인 페이지로 이동합니다.");
      setTimeout(() => navigate("/login"), 2000);
    } else {
      setError(data.error || "오류가 발생했습니다.");
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex flex-col items-center px-4 pt-10">
      <h1 className="text-2xl font-bold mb-6">비밀번호 재설정</h1>

      <div className="w-80 space-y-4">
        <input
          type="password"
          placeholder="새 비밀번호"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-3 py-2 border rounded-lg bg-white text-black dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <input
          type="password"
          placeholder="비밀번호 확인"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="w-full px-3 py-2 border rounded-lg bg-white text-black dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={handleSubmit}
          disabled={!password || !confirmPassword || loading}
          className={`w-full py-2 rounded-lg font-semibold transition ${
            !password || !confirmPassword || loading
              ? "bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-not-allowed"
              : "bg-blue-600 hover:bg-blue-700 text-white"
          }`}
        >
          {loading ? "변경 중..." : "비밀번호 변경"}
        </button>
        {error && <p className="text-center text-sm text-red-500">{error}</p>}
        {message && <p className="text-center text-sm text-green-600 dark:text-green-400">{message}</p>}
      </div>
    </div>
  );
}
