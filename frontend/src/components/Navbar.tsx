import { Link } from "react-router-dom";

function Navbar() {
  return (
    <nav className="bg-transparent py-4 text-black dark:text-white justify-center items-center">
      <div className="container mx-auto flex space-x-4 justify-center items-center">
        <Link to="/" className="text-base sm:text-lg md:text-xl font-bold break-keep">
          🔍 성향 테스트
        </Link>
        <Link to="/decks" className="text-base sm:text-lg md:text-xl break-keep">
          📂 결과 모아보기
        </Link>
        <Link to="/changelog" className="text-base sm:text-lg md:text-xl break-keep">
          📜 패치노트
        </Link>
      </div>
    </nav>
  );
}

export default Navbar;
