import { useState } from "react";
import { register, checkEmailExists, checkUsernameExists } from "../api/AccountApi";
import { useNavigate } from "react-router-dom";

const Register = () => {
    const [email, setEmail] = useState("");
    const [username, setUsername] = useState("");
    const [password1, setPassword] = useState("");
    const [password2, setPassword2] = useState("");
    const [message, setMessage] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [emailError, setEmailError] = useState("");
    const isValidEmail = (email: string): boolean => {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return emailRegex.test(email);
    };
    const [usernameError, setUsernameError] = useState("");
    const navigate = useNavigate();

    const handleEmailChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const newEmail = e.target.value;
      setEmail(newEmail);
      setEmailError("");
  
      if (!isValidEmail(newEmail)) {
          setEmailError("유효한 이메일 주소를 입력해주세요.");
          return;
      }
  
      const exists = await checkEmailExists(newEmail);
      if (exists) {
          setEmailError("이미 사용 중인 이메일입니다.");
      }
    };

    const handleUsernameChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const newUsername = e.target.value;
      setUsername(newUsername);
      setUsernameError("");

      if (newUsername) {
        const exists = await checkUsernameExists(newUsername);
        if (exists) {
          setUsernameError("이미 사용 중인 닉네임입니다.");
        }
      }
    };

    const handleRegister = async () => {
        if (!email || !username || !password1 || !password2) {
            setMessage("모든 필드를 입력해주세요.");
            return;
        }
        if (password1 !== password2) {
            setMessage("비밀번호가 일치하지 않습니다.");
            return;
        }
        if (emailError) {
            setMessage("이메일을 확인해주세요.");
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
                    onChange={handleEmailChange}
                    className="w-full p-2 border rounded-md"
                    disabled={isLoading}
                />
                {emailError && <p className="text-red-500 text-sm mt-1">{emailError}</p>}
            </div>
            <div className="mt-6 w-80">
                <input
                    type="text"
                    placeholder="닉네임"
                    value={username}
                    onChange={handleUsernameChange}
                    className="w-full p-2 border rounded-md"
                    disabled={isLoading}
                />
                {usernameError && <p className="text-red-500 text-sm mt-1">{usernameError}</p>}
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
                    isLoading || emailError || usernameError
                        ? "bg-gray-400 cursor-not-allowed"
                        : "bg-blue-500 hover:bg-blue-600 text-white"
                }`}
                onClick={handleRegister}
                disabled={isLoading || !!emailError || !!usernameError}
            >
                {isLoading ? "가입 진행 중..." : "회원가입"}
            </button>
            {message && <p className="mt-4 text-center text-red-500">{message}</p>}
        </div>
    );
};

export default Register;
