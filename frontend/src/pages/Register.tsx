import { useState } from "react";
import { register } from "../api/AccountApi";
import { useNavigate } from "react-router-dom";

const Register = () => {
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [message, setMessage] = useState("");
    const navigate = useNavigate();

    const handleRegister = async () => {
        const result = await register(username, password);
        if (result.error) {
            setMessage(result.error);
        } else {
            setMessage("회원가입 성공. 로그인 페이지로 이동합니다.");
            setTimeout(() => navigate("/login"), 1500);
        }
    };

    return (
        <div className = "h-auto min-h-screen">
            <div className="mt-6">
            <input
                type="text"
                placeholder="사용자명"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
            />
            </div>
            <div className="mt-6">
            <input
                type="password"
                placeholder="비밀번호"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
            />
            </div>
            <button className="mt-6 bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 transition-all"
            onClick={handleRegister}>회원가입</button>
            {message && <p>{message}</p>}

        </div>
    );
};

export default Register;
