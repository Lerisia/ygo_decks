import React from "react";

const patchNotes = [
  {
    version: "v2.0.0",
    date: "2025.02.28",
    changes: [
      "플랫폼 이동 (스모어 -> 개인 홈페이지)",
      "질문 추가 및 정확도 개선",
      "다크 모드 지원",
      "게이트가디언, 마탄환, 메탈포제, 회멸, 몽마경, 푸른 눈의 백룡, 천후의 7개 덱 추가 (총 129종)",
    ],
  },
  {
    version: "v1.3.0",
    date: "2025.02.15",
    changes: [
      "전체적 티어 재조정",
      "정룡, 트릭스터, 해황머메일, 서브테러, 퍼니멀의 5개 덱 추가 (총 122종)",
    ],
  },
  {
    version: "v1.2.2",
    date: "2024.11.22",
    changes: [
      "스프리건즈, 빛의 황금궤, 화염의 검사, 성잔, 타키온의 5개 덱 추가 (총 117종)",
    ],
  },
  {
    version: "v1.2.1",
    date: "2024.10.28",
    changes: [
      "기믹 퍼핏, 환주, 잭나이츠, 곤충GS, 저주받은 하인, 엑조디아, 리브로맨서의 7개 덱 추가 (총 112종)",
    ],
  },
  {
    version: "v1.2.0",
    date: "2024.10.14",
    changes: [
      "덱 파워 분류를 기존 3단계(티어권 상위/티어권 하위/비티어)에서 더 정확하고 직관적인 4단계(티어권/준티어권/비티어권/하위권)로 개편",
      "식물 링크, 전뇌계, 플런드롤, 고블린라이더, 보옥수, 인페르노이드, 워크라이의 7개 덱 추가 (총 105종)",
    ],
  },
  {
    version: "v1.1.1",
    date: "2024.09.07",
    changes: [
      "진룡, 라이트로드, 인페르니티, 룡검사, 명세계, 땅기계, 세피라, 앤틱 기어, 코드 토커의 9개 덱 추가 (총 98종)",
    ],
  },
  {
    version: "v1.1.0",
    date: "2024.08.23",
    changes: [
      "저렴한 덱 기준 및 리스트 재정비",
      "RR, 블랙 매지션, 마계극단, 뱀파이어, DD, 라의 익신룡, LL, 천배룡(미출시)의 8개 덱 추가 (총 89종)",
    ],
  },
  {
    version: "v1.0.0",
    date: "2024.08.20",
    changes: [
      "마스터 듀얼에 출시된 덱 중 최근 마스터 1 달성이 있는 덱 81종 수록",
    ],
  },
];

const Changelog: React.FC = () => {
  return (
    <div className="max-w-2xl mx-auto p-6 bg-gray-100 rounded-lg shadow-lg">
      <h1 className="text-2xl font-bold text-gray-900 mb-4">패치 노트</h1>
      <div className="space-y-6">
        {patchNotes.map((note, index) => (
          <div key={index} className="p-4 bg-white rounded-lg shadow">
            <h2 className="text-lg font-semibold text-gray-800">
              {note.version} <span className="text-sm text-gray-500">({note.date})</span>
            </h2>
            <ul className="mt-2 text-left list-disc list-inside text-gray-700 break-keep">
              {note.changes.map((change, idx) => (
                <li key={idx}>{change}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Changelog;