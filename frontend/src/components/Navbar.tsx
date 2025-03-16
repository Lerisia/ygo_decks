import { Link } from "react-router-dom";
import { isAuthenticated } from "../api/accountApi";

function Navbar() {
  const isLoggedIn = isAuthenticated();

  return (
    <nav className="bg-transparent py-4 text-black dark:text-white justify-center items-center">
      <div className="container mx-auto flex space-x-4 justify-center items-center">
        <Link to="/" className="text-base sm:text-lg md:text-xl font-bold break-keep">
          🔍 성향 테스트
        </Link>
        <Link to="/info" className="text-base sm:text-lg md:text-xl break-keep">
          📖 사용 설명서
        </Link>
        <Link to="/database" className="text-base sm:text-lg md:text-xl break-keep">
          📚 덱 도감
        </Link>
        <Link to="/statistics" className="text-base sm:text-lg md:text-xl break-keep">
          📊 통계
        </Link>
        {isLoggedIn ? (
          <Link to="/mypage" className="text-base sm:text-lg md:text-xl break-keep">
          👤 마이페이지
        </Link>
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
