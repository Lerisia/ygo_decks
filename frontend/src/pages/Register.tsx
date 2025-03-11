import { useState, useEffect } from "react";
import { register, checkEmailExists, checkUsernameExists } from "../api/accountApi";
import { useNavigate } from "react-router-dom";

const Register = () => {
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password1, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const [emailError, setEmailError] = useState("");
  const [usernameError, setUsernameError] = useState("");
  const [checkingEmail, setCheckingEmail] = useState(false);
  const [checkingUsername, setCheckingUsername] = useState(false);

  const navigate = useNavigate();

  const isValidEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  // Email validation & duplication check
  useEffect(() => {
    if (email.length === 0) {
      setEmailError("");
      return;
    }

    if (!isValidEmail(email)) {
      setEmailError("유효한 이메일 주소를 입력해주세요.");
      return;
    }

    setCheckingEmail(true);

    const timeoutId = setTimeout(async () => {
      const exists = await checkEmailExists(email);
      setEmailError(exists ? "이미 사용 중인 이메일입니다." : "");
      setCheckingEmail(false);
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [email]);

  // Username validation & duplication check
  useEffect(() => {
    if (username.length === 0) {
      setUsernameError("");
      return;
    }

    if (username.length < 3) {
      setUsernameError("닉네임은 최소 3글자 이상이어야 합니다.");
      return;
    }

    setCheckingUsername(true);

    const timeoutId = setTimeout(async () => {
      const exists = await checkUsernameExists(username);
      setUsernameError(exists ? "이미 사용 중인 닉네임입니다." : "");
      setCheckingUsername(false);
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [username]);

  // Register button handler
  const handleRegister = async () => {
    if (!email || !username || !password1 || !password2) {
      setMessage("모든 필드를 입력해주세요.");
      return;
    }
    if (password1 !== password2) {
      setMessage("비밀번호가 일치하지 않습니다.");
      return;
    }
    if (emailError || usernameError) {
      setMessage("입력 정보를 확인해주세요.");
      return;
    }

    setIsLoading(true);
    setMessage("인증 이메일을 전송하는 중입니다...");

    const result = await register(email, username, password1, password2);

    setIsLoading(false);

    if (result.error) {
      setMessage(result.error);
    } else {
      setMessage("회원가입 성공! 이메일을 확인하고 인증을 완료해주세요.");
      setTimeout(() => navigate("/login"), 3000);
    }
  };

  return (
    <div className="h-auto min-h-screen flex flex-col items-center">
      <div className="mt-6 w-80">
        <input
          type="email"
          placeholder="이메일 주소"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full p-2 border rounded-md"
          disabled={isLoading}
        />
        {checkingEmail ? (
          <p className="text-gray-500 text-sm mt-1">중복 확인 중...</p>
        ) : emailError ? (
          <p className="text-red-500 text-sm mt-1">{emailError}</p>
        ) : null}
      </div>

      <div className="mt-6 w-80">
        <input
          type="text"
          placeholder="닉네임"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="w-full p-2 border rounded-md"
          disabled={isLoading}
        />
        {checkingUsername ? (
          <p className="text-gray-500 text-sm mt-1">중복 확인 중...</p>
        ) : usernameError ? (
          <p className="text-red-500 text-sm mt-1">{usernameError}</p>
        ) : null}
      </div>

      <div className="mt-6 w-80">
        <input
          type="password"
          placeholder="비밀번호"
          value={password1}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full p-2 border rounded-md"
          disabled={isLoading}
        />
      </div>

      <div className="mt-6 w-80">
        <input
          type="password"
          placeholder="비밀번호 확인"
          value={password2}
          onChange={(e) => setPassword2(e.target.value)}
          className="w-full p-2 border rounded-md"
          disabled={isLoading}
        />
      </div>

      <button
        className={`mt-6 px-4 py-2 rounded-lg transition-all ${
          isLoading || emailError || usernameError || checkingEmail || checkingUsername || username.length < 3
            ? "bg-gray-400 cursor-not-allowed"
            : "bg-blue-500 hover:bg-blue-600 text-white"
        }`}
        onClick={handleRegister}
        disabled={isLoading || !!emailError || !!usernameError || checkingEmail || checkingUsername || username.length < 3}
      >
        {isLoading ? "가입 진행 중..." : "회원가입"}
      </button>

      {message && <p className="mt-4 text-center text-red-500">{message}</p>}
    </div>
  );
};

export default Register;
