function Info() {
  return (
    <div className="p-6 h-auto min-h-screen max-w-3xl mx-auto text-gray-900 dark:text-white">
      <h1 className="text-2xl font-bold mb-4"> YGO Decks 소개</h1>
      <p className="mb-4 break-keep">
        이 사이트는 <strong>'유희왕 마스터 듀얼'</strong> 유저를 위한 다양한 기능을 제공합니다.
      </p>

      <h2 className="text-xl font-semibold mt-6 mb-2">🔍 덱 성향 테스트</h2>
      <p className="mb-4 break-keep">
        기존에 Smore 플랫폼을 통해 제공되던 덱 성향 테스트입니다.
        <br />
        새로운 버전은 <strong>더 상세한 질문과 정확한 결과를 제공하며, 유지 보수가 간편하도록 개선</strong>되었습니다.
      </p>

      <h2 className="text-xl font-semibold mt-6 mb-2">📚 덱 도감</h2>
      <p className="mb-4 break-keep">
        숙련자를 위한 기능으로 <strong>덱 성향 테스트보다 편하게 원하는 카테고리의 덱을 모아 볼 수 있습니다.</strong>
        <br />
        덱의 특징, 장단점, 플레잉 팁, 덱 리스트 등을 확인할 수 있습니다.
        <br />
        아직 내용이 부족하지만, 이용자들의 참여로 점점 채워 나가고 있습니다.
      </p>

      <h2 className="text-xl font-semibold mt-6 mb-2">📝 전적 시트</h2>
      <p className="mb-4 break-keep">
        전적을 기록하고 통계를 내는 기능입니다. 모두가 궁금해 하는 코인토스 승률 뿐만 아니라 덱 별 승률 등 다양한 통계를 제공합니다.
        <br />
        추후 켜 놓기만 하면 전적을 트래킹하는 툴을 개발 예정입니다.
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
        className="inline-flex items-center px-4 py-2 bg-red-500 text-white text-lg font-bold rounded-lg shadow-md hover:bg-red-600 transition"
      >
        ☕ Buy me a coffee
      </a>
    </div>
  );
}

export default Info;
