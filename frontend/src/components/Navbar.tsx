import { Link, useNavigate } from "react-router-dom";
import { isAuthenticated, logout } from "../api/AccountApi";

function Navbar() {
  const isLoggedIn = isAuthenticated();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/");
  };

  return (
    <nav className="bg-transparent py-4 text-black dark:text-white justify-center items-center">
      <div className="container mx-auto flex space-x-4 justify-center items-center">
        <Link to="/" className="text-base sm:text-lg md:text-xl font-bold break-keep">
          🔍 성향 테스트
        </Link>
        <Link to="/info" className="text-base sm:text-lg md:text-xl break-keep">
          📖 사용 설명서
        </Link>
        <Link to="/statistics" className="text-base sm:text-lg md:text-xl break-keep">
          📊 통계
        </Link>
        <Link to="/changelog" className="text-base sm:text-lg md:text-xl break-keep">
          📜 패치노트
        </Link>
        {isLoggedIn ? (
          <span
            className="text-base sm:text-lg md:text-xl break-keep cursor-pointer"
            onClick={handleLogout}
          >
            🚪 로그아웃
          </span>
        ) : (
          <Link to="/login" className="text-base sm:text-lg md:text-xl break-keep">
            🔑 로그인
          </Link>
        )}
      </div>
    </nav>
  );
}

export default Navbar;
