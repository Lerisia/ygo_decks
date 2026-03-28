import { useNavigate } from "react-router-dom";

export default function EmailVerified() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex flex-col items-center px-4 pt-10">
      <h1 className="text-3xl font-bold text-center">인증 성공!</h1>
      <p className="text-gray-500 dark:text-gray-400 mt-2 text-center text-lg">
        YGODecks에 가입하신 것을 환영합니다.
      </p>

      <img
        src="/media/card_illusts/538097900_fxoXy5g.jpg"
        alt="웰컴 라뷰린스"
        className="mt-6 mx-auto w-48 sm:w-56 md:w-64 lg:w-72 max-w-full rounded-lg shadow-lg"
      />
      <p className="mt-2 text-sm text-gray-400 dark:text-gray-500">웰컴 라뷰린스</p>

      <button
        onClick={() => navigate("/login")}
        className="mt-6 px-6 py-3 bg-blue-600 text-white text-lg font-semibold rounded-lg hover:bg-blue-700 transition"
      >
        로그인하러 가기
      </button>
    </div>
  );
}
