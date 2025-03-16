import { useNavigate } from "react-router-dom";

function Info() {
  const navigate = useNavigate();

  return (
    <div className="p-6 h-auto min-h-screen max-w-3xl mx-auto text-gray-900 dark:text-white">
      <h1 className="text-2xl font-bold mb-4">사이트 소개</h1>
      <p className="mb-4 break-keep">
        이 사이트는 <strong>'유희왕 마스터 듀얼'</strong> 유저를 위한 덱 성향 테스트를 제공합니다.
      </p>
      <p className="mb-4 break-keep">
        기존에 Smore 플랫폼을 통해 제공되던 덱 성향 테스트입니다.
        <br />
        새로운 버전은 <strong>더 상세한 질문과 정확한 결과를 제공하며, 유지 보수가 간편하도록 개선</strong>되었습니다.
        <br />
        또한 <strong>덱 데이터베이스, 뉴비 덱 추천, 통계</strong> 등 다양한 기능을 개발 중에 있습니다.
      </p>
      <p className="mb-4 break-keep">
        이 사이트의 모든 기능은 <strong>광고 없이 무료</strong>로 제공되므로, 언제든지 편하게 이용해 주세요!
      </p>

      <h2 className="text-xl font-semibold mt-6 mb-2">💬 버그 제보 및 기능 제안</h2>
      <p className="mb-4 break-keep">
        아래 오픈채팅을 통해 문의해 주세요.<br />  
        <a
          href="https://open.kakao.com/o/sDIT5F2c"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-500 hover:underline"
        >
          카카오톡 오픈채팅방 바로가기
        </a>
      </p>

      <h2 className="text-xl font-semibold mt-6 mb-2">⭐ 후원하기</h2>
      <a
        href="https://www.buymeacoffee.com/elyss"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center px-4 py-2 bg-[#FF5F5F] text-white text-lg font-bold rounded-lg shadow-md hover:bg-[#E64C4C] transition"
      >
        ☕ Buy me a coffee
      </a>

      {/* 패치노트 버튼 */}
      <div className="mt-6">
        <button
          onClick={() => navigate("/changelog")}
          className="px-4 py-2 bg-blue-500 text-white font-semibold rounded-lg shadow-md hover:bg-blue-600 transition"
        >
          📜 패치노트 보기
        </button>
      </div>
    </div>
  );
}

export default Info;
