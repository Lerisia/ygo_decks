import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { login, isAuthenticated } from "../api/accountApi";

const Login = () => {
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [message, setMessage] = useState("");
    const navigate = useNavigate();

    useEffect(() => {
        if (isAuthenticated()) {
            setMessage("이미 로그인되었습니다. 메인 페이지로 이동합니다.");
            setTimeout(() => navigate("/"), 500);
        }
    }, [navigate]);

    const handleLogin = async () => {
        const result = await login(username, password);
        if (result.access) {
            setMessage("로그인 성공. 메인 페이지로 이동합니다.");
            setTimeout(() => {
                navigate("/");
                setTimeout(() => window.location.reload(), 100);
            }, 500);
        } else {
            setMessage(
                "로그인 실패: " +
                (result.error || "아이디 또는 비밀번호가 잘못되었습니다.\n이메일 인증을 완료하지 않았다면 인증을 진행해주세요.")
            );
        }
    };
    

    return (
        <div className = "h-auto min-h-screen flex flex-col items-center">
            <div className="mt-6">
            <input
                type="text"
                placeholder="이메일 주소"
                className="w-full p-2 border rounded-md bg-white text-black dark:bg-gray-800 dark:text-white"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
            />
            </div>
            <div className="mt-6">
            <input
                type="password"
                placeholder="비밀번호"
                className="w-full p-2 border rounded-md bg-white text-black dark:bg-gray-800 dark:text-white"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
            />
            </div>
            <button className="mt-6 bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 transition-all"
            onClick={handleLogin}>로그인</button>
            {message && <p style={{ marginTop: "8px", whiteSpace: "pre-line" }}>{message}</p>}

            <p className="mt-4">
                계정이 없으신가요?{" "}
                <button
                    onClick={() => navigate("/register")}
                    className="text-blue-400 underline"
                >
                    회원가입
                </button>
            </p>
        </div>
    );
};

export default Login;
