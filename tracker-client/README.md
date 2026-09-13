# mdtracker

Master Duel(PC/Steam) 전적 자동 수집 트래커. 프로세스 메모리를 **읽기만** 한다(주입·후킹·쓰기 없음, 관리자 권한 불필요).

## mdpeek (1단계: 정찰 도구)

`tracker-client/mdpeek/` — .NET 8 콘솔, `dotnet publish -c Release -o publish` 로 `publish/mdpeek.exe`(self-contained 단일 파일) 생성. Linux에서 크로스 빌드 가능.

```
mdpeek dump [file.json]     ClientWork 트리 전체($.*)를 JSON으로 저장
mdpeek get $.Duel $.DuelResult $.User.profile    특정 경로만 출력
mdpeek keys [$.path]        키 목록
mdpeek duel                 DuelClient/Engine 상태 한 번 출력
mdpeek cards                PvP 엔진이 아는 카드 ID 목록(상대 덱 정찰)
mdpeek watch [outdir]       500ms 폴링, 듀얼 단계 변화 로그 + 스냅샷 자동 저장 (기본 .\snapshots)
mdpeek classes <substr>     클래스 이름 검색(전체 스캔)
```

동작 원리: `GameAssembly.dll`의 쓰기 가능 섹션을 스캔해 자기 참조(`klass == this`)하는 `Il2CppClass`를 이름으로 찾는다 → `static_fields(+0xB8)` → `ClientWork.s_data`(서버 응답 JSON 트리), `DuelClient.instance`, `Engine.s_instance`. 필드 오프셋은 `Game.cs`의 `Off` 클래스 한 곳에 모여 있고 MD 2.8.0 덤프 기준(`/home/elyss/recon/mdtracker/RECON.md`).

게임 업데이트 후 깨지면: Il2CppDumper 재실행 → `extract.py dump.cs DuelClient DuelEndOperation Engine Engine.PvpDuelInfo Engine.PvpUIDBase` 로 오프셋 재확인 → `Off` 갱신.
