import { Link } from "react-router-dom";
import { isAuthenticated } from "../api/accountApi";
import logo from "/images/logo_big.png";

function Navbar() {
  const isLoggedIn = isAuthenticated();

  return (
    <header className="bg-transparent text-black dark:text-white">
      <div className="sm:hidden flex flex-col items-center py-4 space-y-4">
        <Link to="/" className="hover:opacity-80 transition">
          <img src={logo} alt="사이트 로고" className="h-16 object-contain" />
        </Link>
        <nav className="flex flex-wrap justify-center gap-x-4 gap-y-2">
          <Link to="/recommend" className="text-base font-bold break-keep">
            🔍 성향 테스트
          </Link>
          <Link to="/database" className="text-base break-keep">
            📚 덱 도감
          </Link>
          <Link to="/records" className="text-base break-keep">
            📝 전적 시트
          </Link>
          <Link to="/deck-detector" className="text-base break-keep">
            🪄 AI 덱 추출
          </Link>
          {isLoggedIn ? (
            <Link to="/mypage" className="text-base break-keep">
              👤 마이페이지
            </Link>
          ) : (
            <Link to="/login" className="text-base break-keep">
              🔑 로그인
            </Link>
          )}
        </nav>
      </div>
      <div className="hidden sm:flex justify-center py-4">
        <div className="flex items-center space-x-8">
          <Link to="/" className="hover:opacity-80 transition shrink-0">
            <img src={logo} alt="사이트 로고" className="h-24 object-contain" />
          </Link>
          <nav className="flex space-x-6 items-center">
            <Link to="/recommend" className="text-lg md:text-xl font-bold break-keep">
              🔍 성향 테스트
            </Link>
            <Link to="/database" className="text-lg md:text-xl break-keep">
              📚 덱 도감
            </Link>
            <Link to="/records" className="text-lg md:text-xl break-keep">
              📝 전적 시트
            </Link>
            <Link to="/deck-detector" className="text-lg md:text-xl break-keep">
              🪄 AI 덱 추출기
            </Link>
            {isLoggedIn ? (
              <Link to="/mypage" className="text-lg md:text-xl break-keep">
                👤 마이페이지
              </Link>
            ) : (
              <Link to="/login" className="text-lg md:text-xl break-keep">
                🔑 로그인
              </Link>
            )}
          </nav>
        </div>
      </div>
    </header>
  );
}

export default Navbar;
