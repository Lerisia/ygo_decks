import { Link } from "react-router-dom";

function Recommend() {
  return (
    <div className="p-4 text-center h-auto min-h-screen items-center">
      <div>
        {/* YGO Master Duel Logo Image */}
        <div className="relative mb-6">
          <img src="/images/md_logo_small.jpg" alt="Small" className="block mx-auto sm:hidden w-full h-auto" />
          <img src="/images/md_logo_big.jpg" alt="Large" className="hidden sm:block w-3/4 sm:w-3/4 md:w-3/4 lg:w-3/4 mx-auto object-cover rounded-lg" />
        </div>
        {/* The title and descriptions */}
        <h1 className="text-xl sm:text-2xl md:text-4xl font-bold">유희왕 마스터 듀얼 덱 성향 테스트</h1>
        <p className="text-lg mt-2 break-keep">
          간단한 문답을 통해 나와 어울리는 덱 알아보기.
        </p>
        <p className="text-lg mt-2 break-keep">
          회원가입을 통해 내 덱 저장하고 관리하기, 보유한 덱을 테스트에서 제외하기 등 다양한 추가 기능을 사용할 수 있습니다.
        </p>
        {/* <p className="text-lg text-red-600 mt-2 break-keep">
          현재 점검 중으로 제대로 동작하지 않을 수 있습니다.
        </p> */}
        <Link to="/questions">
          <button className="mt-4 bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 transition-all">
            테스트 시작
          </button>
        </Link>
      </div>
    </div>
  )
}

export default Recommend;
