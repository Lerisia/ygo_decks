import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getUserInfo, changeUsername, changePassword, logout, checkUsernameExists } from "../api/accountApi";
import { getMyAvatar, type PublicCardIcon, type Border } from "@/api/avatarApi";
import Avatar from "@/components/Avatar";

const Mypage = () => {
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [originalUsername, setOriginalUsername] = useState("");
  const [isUsernameValid, setIsUsernameValid] = useState<boolean | null>(null);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [message, setMessage] = useState("");
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [avatarIcon, setAvatarIcon] = useState<PublicCardIcon | null>(null);
  const [avatarBorder, setAvatarBorder] = useState<Border | null>(null);

  const navigate = useNavigate();

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      navigate("/unauthorized");
      return;
    }

    const fetchUserInfo = async () => {
      const userInfo = await getUserInfo();
      if (userInfo) {
        setEmail(userInfo.email);
        setUsername(userInfo.username);
        setOriginalUsername(userInfo.username);
      }
    };
    fetchUserInfo();
    getMyAvatar().then((d) => { setAvatarIcon(d.icon); setAvatarBorder(d.border); }).catch(() => {});
  }, [navigate]);

  const handleChangeUsername = async () => {
    if (!isUsernameValid || username === "" || username === originalUsername) return;
    const response = await changeUsername(username);
    setMessage(response.message || response.error);
  };

  const handleChangePassword = async () => {
    if (newPassword !== confirmNewPassword) {
      setPasswordError("새 비밀번호가 일치하지 않습니다.");
      return;
    }
    setPasswordError("");
    const response = await changePassword(currentPassword, newPassword);
    if (response.error) {
      setMessage(response.error.includes("현재 비밀번호")
        ? "현재 비밀번호가 올바르지 않습니다."
        : response.error);
    } else {
      setMessage("비밀번호가 성공적으로 변경되었습니다.");
    }
  };

  const handleLogout = () => {
    logout();
    navigate("/");
    setTimeout(() => window.location.reload(), 100);
  };

  useEffect(() => {
    if (username.length < 3) {
      setIsUsernameValid(null);
      return;
    }
    setCheckingUsername(true);
    const timeoutId = setTimeout(async () => {
      const exists = await checkUsernameExists(username);
      setIsUsernameValid(!exists);
      setCheckingUsername(false);
    }, 500);
    return () => clearTimeout(timeoutId);
  }, [username]);

  const toggle = (section: string) =>
    setExpandedSection((prev) => (prev === section ? null : section));

  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains("dark"));

  const toggleDarkMode = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  };

  const inputClass = "w-full px-3 py-2 border rounded-lg bg-white text-black dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500";

  return (
    <div className="h-auto min-h-screen px-4 py-6">
      <div className="w-full max-w-md mx-auto space-y-3">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 flex items-center gap-4">
          <button
            onClick={() => navigate("/mypage/avatar")}
            className="shrink-0 transition hover:opacity-80"
            title="아이콘 변경"
          >
            <Avatar icon={avatarIcon} border={avatarBorder} size={64} />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-gray-500 dark:text-gray-400">이메일</p>
            <p className="font-medium truncate">{email}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">닉네임</p>
            <p className="font-medium truncate">{originalUsername}</p>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow px-4 py-3 flex items-center justify-between">
          <span className="font-semibold">다크 모드</span>
          <button
            onClick={toggleDarkMode}
            className={`relative w-12 h-6 rounded-full transition-colors ${isDark ? "bg-blue-600" : "bg-gray-300"}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${isDark ? "translate-x-6" : ""}`} />
          </button>
        </div>

        <button
          onClick={() => navigate("/mypage/mydecks")}
          className="w-full py-3 bg-white dark:bg-gray-800 rounded-xl shadow text-left px-4 font-semibold hover:bg-gray-50 dark:hover:bg-gray-700 transition"
        >
          보유 덱 관리 →
        </button>

        <button
          onClick={() => navigate("/mypage/avatar")}
          className="w-full py-3 bg-white dark:bg-gray-800 rounded-xl shadow text-left px-4 font-semibold hover:bg-gray-50 dark:hover:bg-gray-700 transition"
        >
          아이콘 설정 →
        </button>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow">
          <button
            onClick={() => toggle("username")}
            className="w-full px-4 py-3 text-left font-semibold flex justify-between items-center"
          >
            닉네임 변경
            <span className="text-gray-400">{expandedSection === "username" ? "▲" : "▼"}</span>
          </button>
          {expandedSection === "username" && (
            <div className="px-4 pb-4 space-y-2">
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className={inputClass}
                placeholder="새 닉네임"
              />
              <p className="text-xs">
                {username.length < 3 ? (
                  <span className="text-red-500">최소 3글자 이상</span>
                ) : checkingUsername ? (
                  <span className="text-gray-500">확인 중...</span>
                ) : username === originalUsername ? (
                  <span className="text-gray-500">현재 닉네임과 동일</span>
                ) : isUsernameValid ? (
                  <span className="text-green-500">사용 가능</span>
                ) : (
                  <span className="text-red-500">이미 사용 중</span>
                )}
              </p>
              <button
                onClick={handleChangeUsername}
                className={`w-full py-2 rounded-lg font-semibold transition ${
                  isUsernameValid && username !== originalUsername
                    ? "bg-blue-600 hover:bg-blue-700 text-white"
                    : "bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-not-allowed"
                }`}
                disabled={!isUsernameValid || username === originalUsername}
              >
                변경
              </button>
            </div>
          )}
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow">
          <button
            onClick={() => toggle("password")}
            className="w-full px-4 py-3 text-left font-semibold flex justify-between items-center"
          >
            비밀번호 변경
            <span className="text-gray-400">{expandedSection === "password" ? "▲" : "▼"}</span>
          </button>
          {expandedSection === "password" && (
            <div className="px-4 pb-4 space-y-2">
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className={inputClass}
                placeholder="현재 비밀번호"
              />
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={inputClass}
                placeholder="새 비밀번호"
              />
              <input
                type="password"
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                className={inputClass}
                placeholder="새 비밀번호 확인"
              />
              {passwordError && <p className="text-red-500 text-xs">{passwordError}</p>}
              <button
                onClick={handleChangePassword}
                className={`w-full py-2 rounded-lg font-semibold transition ${
                  newPassword && newPassword === confirmNewPassword
                    ? "bg-blue-600 hover:bg-blue-700 text-white"
                    : "bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-not-allowed"
                }`}
                disabled={!newPassword || newPassword !== confirmNewPassword}
              >
                변경
              </button>
            </div>
          )}
        </div>

        <button
          onClick={handleLogout}
          className="w-full py-3 text-red-500 font-semibold text-center"
        >
          로그아웃
        </button>

        <button
          onClick={async () => {
            if (!confirm("정말로 계정을 삭제하시겠습니까?\n30일간 유예 후 완전히 삭제됩니다.")) return;
            const token = localStorage.getItem("access_token");
            const res = await fetch("/api/delete-account/", {
              method: "DELETE",
              headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) {
              localStorage.removeItem("access_token");
              navigate("/");
              setTimeout(() => window.location.reload(), 100);
            }
          }}
          className="w-full py-3 text-gray-400 dark:text-gray-500 text-sm text-center"
        >
          계정 삭제
        </button>

        {message && <p className="text-center text-sm text-gray-600 dark:text-gray-400">{message}</p>}
      </div>
    </div>
  );
};

export default Mypage;
