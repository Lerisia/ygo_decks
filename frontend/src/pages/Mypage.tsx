import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getUserInfo, changeUsername, changePassword, logout, checkUsernameExists } from "../api/accountApi";

const Mypage = () => {
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [originalUsername, setOriginalUsername] = useState(""); // 기존 닉네임 저장
  const [isUsernameValid, setIsUsernameValid] = useState<boolean | null>(null);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [message, setMessage] = useState("");

  const navigate = useNavigate();

  // Check if the user is logged in & fetch user info
  useEffect(() => {
    const token = localStorage.getItem("access_token");

    if (!token) {
      navigate("/unauthorized");
      return;
    }

    // Fetch user info (e-mail, username)
    const fetchUserInfo = async () => {
      const userInfo = await getUserInfo();
      if (userInfo) {
        setEmail(userInfo.email);
        setUsername(userInfo.username);
        setOriginalUsername(userInfo.username);
      }
    };

    fetchUserInfo();
  }, [navigate]);

  // Change username handler
  const handleChangeUsername = async () => {
    if (!isUsernameValid || username === "" || username === originalUsername) return;
    const response = await changeUsername(username);
    setMessage(response.message || response.error);
  };

  // Change password handler
  const handleChangePassword = async () => {
    if (newPassword !== confirmNewPassword) {
      setPasswordError("새 비밀번호가 일치하지 않습니다.");
      return;
    }
  
    setPasswordError("");
    const response = await changePassword(currentPassword, newPassword);
  
    if (response.error) {
      setMessage(response.error);
      if (response.error.includes("현재 비밀번호")) {
        setMessage("현재 비밀번호가 올바르지 않습니다. 다시 확인해주세요.");
      }
    } else {
      setMessage("비밀번호가 성공적으로 변경되었습니다.");
    }
  };

  // Logout
  const handleLogout = () => {
    logout();
    navigate("/");

    setTimeout(() => {
      window.location.reload();
    }, 100);
  };

  // Username duplication check & validation
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

  return (
    <div className="h-auto min-h-screen px-4 text-center p-4">
      <div className="w-full max-w-md bg-white shadow-lg rounded-xl mx-auto p-6">
        <h2 className="text-2xl font-semibold text-center mb-4">마이페이지</h2>

        {/* Email (Read-only) */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-500">이메일</label>
          <p className="w-full px-3 py-2 border rounded-lg bg-gray-100 text-gray-500 cursor-not-allowed">{email}</p>
        </div>

        {/* Change username */}
        <div className="mb-4">
          <label className="block text-sm font-medium">닉네임</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-black dark:bg-gray-800 dark:text-white"
          />
          <p className="text-sm mt-1">
            {username.length < 3 ? (
              <span className="text-red-500">닉네임은 최소 3글자 이상이어야 합니다.</span>
            ) : checkingUsername ? (
              <span className="text-gray-500">중복 확인 중...</span>
            ) : username === originalUsername ? (
              <span className="text-gray-500">현재 닉네임과 동일합니다.</span>
            ) : isUsernameValid ? (
              <span className="text-green-500">사용 가능한 닉네임입니다.</span>
            ) : (
              <span className="text-red-500">이미 사용 중인 닉네임입니다.</span>
            )}
          </p>
          <button
            onClick={handleChangeUsername}
            className={`w-full mt-2 py-2 rounded-lg ${
              isUsernameValid && username !== originalUsername ? "bg-blue-500 hover:bg-blue-600" : "bg-gray-400 cursor-not-allowed"
            } text-white`}
            disabled={!isUsernameValid || username === originalUsername}
          >
            닉네임 변경
          </button>
        </div>

        {/* Change password */}
        <div className="mb-4">
          <label className="block text-sm font-medium">현재 비밀번호</label>
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-black dark:bg-gray-800 dark:text-white"
          />

          <label className="block text-sm font-medium mt-2">새 비밀번호</label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-black dark:bg-gray-800 dark:text-white"
          />

          <label className="block text-sm font-medium mt-2">새 비밀번호 확인</label>
          <input
            type="password"
            value={confirmNewPassword}
            onChange={(e) => setConfirmNewPassword(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-black dark:bg-gray-800 dark:text-white"
          />
          {passwordError && <p className="text-red-500 text-sm mt-1">{passwordError}</p>}

          <button
            onClick={handleChangePassword}
            className={`w-full mt-2 py-2 rounded-lg ${
              newPassword && newPassword === confirmNewPassword
                ? "bg-green-500 hover:bg-green-600 text-white"
                : "bg-gray-400 cursor-not-allowed text-white"
            }`}
            disabled={!newPassword || newPassword !== confirmNewPassword}
          >
            비밀번호 변경
          </button>
        </div>

        {/* Owned decks configuration button */}
        <div className="mb-4">
          <button
            onClick={() => navigate("/mypage/mydecks")}
            className="w-full py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg"
          >
            보유 덱 관리
          </button>
        </div>

        {/* Logout button */}
        <button
          onClick={handleLogout}
          className="w-full bg-red-500 text-white py-2 rounded-lg hover:bg-red-600"
        >
          로그아웃
        </button>

        {message && <p className="text-center text-sm text-gray-600 mt-2">{message}</p>}
      </div>
    </div>
  );
};

export default Mypage;
