import { Link } from "react-router-dom";

function Decks() {
  return (
    <div className="p-6">
      <h1 className="text-xl sm:text-2xl md:text-4xl font-bold">모든 결과 모아보기</h1>
       <p className="text-lg mt-2">
        준비 중...
      </p>
      <Link to="/" className="text-lg">홈으로</Link>
    </div>
  );
}

export default Decks;