from django.http import JsonResponse
from deck.models import PerformanceTag
from deck.models import AestheticTag

def get_questions(request):
    
    questions = [
        {
            "key": "atag",
            "question": "특별히 선호하는 조건이 있다면?",
            "options": [{"value": None, "label": "모든 덱 보기 (권장)"}] + [
                {"value": aestheticTag.id, "label": aestheticTag.description}
                for aestheticTag in AestheticTag.objects.all()
                if aestheticTag.description != "해당 없음"
            ]
        },
        {
            "key": "s",
            "question": "원하는 덱 파워는?",
            "options": [
                {"value": 0, "label": "최상위권의 강력한 티어 덱"},
                {"value": 1, "label": "준수한 성능의 준티어 덱"},
                {"value": 2, "label": "나름의 강점이 있는 비티어 덱"},
                {"value": 3, "label": "도전 정신이 필요한 매우 약한 덱"},
                {"value": None, "label": "상관 없음"}
            ]
        },
        {
            "key": "d",
            "question": "원하는 덱 난이도는?",
            "options": [
                {"value": 0, "label": "비교적 쉽게 익히는 직관적인 덱"},
                {"value": 1, "label": "약간의 노력이 필요한 덱"},
                {"value": 2, "label": "높은 게임 이해도가 요구되는 덱"},
                {"value": None, "label": "상관 없음"},
            ]
        },
        {
            "key": "t",
            "question": "선호하는 덱 타입은?",
            "options": [
                {"value": 0, "label": "전개력을 바탕으로 견고한 필드를 구축하는 덱"},
                {"value": 1, "label": "전개와 운영이 균형을 이루는 다재다능한 덱"},
                {"value": 2, "label": "장기전을 유도하여 자원 관리에서 우위를 점하는 덱"},
                {"value": 3, "label": "순수 락, 후공 원턴킬 등 독특한 전략을 구사하는 덱"},
                {"value": None, "label": "상관 없음"},
            ]
        },
        {
            "key": "a",
            "question": "선호하는 일러스트는?",
            "options": [
                {"value": 0, "label": "멋있는 일러스트"},
                {"value": 1, "label": "어두운 일러스트"},
                {"value": 2, "label": "명랑한 일러스트"},
                {"value": 3, "label": "환상적인 일러스트"},
                {"value": 4, "label": "웅장한 일러스트"},
                {"value": None, "label": "상관 없음"},
            ]
        },
        {
            "key": "sm",
            "question": "선호하는 소환법은?",
            "options": [
                {"value": 1, "label": "융합"},
                {"value": 2, "label": "의식"},
                {"value": 3, "label": "싱크로"},
                {"value": 4, "label": "엑시즈"},
                {"value": 5, "label": "펜듈럼"},
                {"value": 6, "label": "링크"},
                {"value": 0, "label": "소환법을 사용하지 않음"},
                {"value": 99, "label": "거의 모든 소환법을 사용"},
                {"value": None, "label": "상관 없음"},
            ]
        },
        {
            "key": "ptag",
            "question": "선호하는 덱 기믹은?",
            "options": [{"value": performanceTag.id, "label": performanceTag.description}
                        for performanceTag in PerformanceTag.objects.all()]
                        + [{"value": None, "label": "상관 없음"}]
        }
    ]

    return JsonResponse({"questions": questions})