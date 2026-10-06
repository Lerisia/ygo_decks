import { Link } from "react-router-dom";

function Recommend() {
  return (
    <div className="min-h-screen flex flex-col items-center px-4 pt-4">
      <div className="relative mb-6 w-full max-w-2xl">
        {/* One picture per screen size: with two <img>s the hidden one was downloaded too (6MB on a phone). */}
        <picture>
          <source media="(min-width: 640px)" srcSet="/images/recommend_illust.webp" />
          <img src="/images/recommend_illust_small.webp" alt="" className="block mx-auto w-full sm:w-3/4 aspect-square sm:aspect-[3/2] object-cover rounded-lg" />
        </picture>
      </div>

      <h1 className="text-2xl sm:text-3xl font-bold text-center break-keep">
        덱 성향 테스트
      </h1>
      <p className="text-gray-500 dark:text-gray-400 mt-2 text-center break-keep">
        간단한 문답으로 나에게 맞는 덱을 찾아보세요.
      </p>

      <div className="flex flex-col gap-3 mt-6 w-full max-w-xs">
        <Link to="/questions">
          <button className="w-full py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition text-lg">
            시작하기
          </button>
        </Link>
      </div>
    </div>
  );
}

export default Recommend;
