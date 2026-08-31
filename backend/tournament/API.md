# 대회(Tournament) API 목록

베이스 경로: `/api/tournaments/`
인증: JWT (`Authorization: Bearer <token>`). 표기 없는 엔드포인트는 비로그인 열람 가능.
에러 응답은 공통적으로 `{"error": "<메시지>"}`.

## 대회 관리

| 메서드/경로 | 권한 | 설명 |
|---|---|---|
| `POST create/` | 회원 | 대회 개설. body: `name`\*, `event_date`\*(ISO), `format`\*(`single_elim`·`swiss`·`round_robin`), `capacity`(2~128, 기본 8), `description`, `format_config`(예: `{"swiss_rounds": 4}`) → 201 + 상세 |
| `GET ` | 공개 | 대회 목록 (취소 제외, 최신순). `?status=recruiting|ongoing|completed` 필터. 각 항목에 `entrant_count`, `host_name` |
| `GET <id>/` | 공개 | 상세: 대회 정보 + `entrants[]`(아바타 아이콘·테두리 포함) + `rounds[].matches[]` + 주최자 아바타. `md_uid`는 주최자·참가자에게만 값, 그 외 null |
| `POST <id>/start/` | 주최자 | 모집 마감·1라운드 대진 생성 (체크인 참가자만 착석, 2명 이상 필요). 라운드 시드 저장 |
| `POST <id>/next-round/` | 주최자 | 현재 라운드 전 경기 확정 시 다음 라운드 생성. 형식별 규칙(엘림=승자 진출, 스위스=승점 그룹·재대결 방지·bye, 라운드로빈=사전 일정). 남은 라운드 없으면 400 |
| `POST <id>/complete/` | 주최자 | 전 경기 확정 시 대회 종료 |

## 모집·참가

| 메서드/경로 | 권한 | 설명 |
|---|---|---|
| `POST <id>/register/` | 회원 | 참가 신청. body: `md_uid`(9자리 숫자) — 프로필에 저장돼 다음 대회부턴 생략 가능. 중복/정원 초과/모집 종료 시 400. 기권자는 같은 자리로 재신청 |
| `POST <id>/withdraw/` | 참가자 | 기권 |
| `POST <id>/check-in/` | 참가자 | 체크인 (신청 상태에서만, 모집 중에만) |
| `POST <id>/kick/` | 주최자 | 참가자 추방. body: `entrant_id` |

## 경기 결과 (셀프 보고 + 상대 확인)

| 메서드/경로 | 권한 | 설명 |
|---|---|---|
| `POST matches/<id>/report/` | 해당 경기 참가자 | 결과 보고. body: `result` = `win`/`lose`/`draw` (보고자 관점) → 서버가 p1/p2/draw로 변환. 엘림에서 draw 400. 확정 전 재보고 가능 |
| `POST matches/<id>/confirm/` | 상대방 | 보고 확인 → 확정. 본인 보고는 본인이 확정 불가 |
| `POST matches/<id>/dispute/` | 상대방 | 이의 제기 → `disputed` |
| `POST matches/<id>/override/` | 주최자 | 강제 확정. body: `result` = `p1`/`p2`/`draw` (엘림에서 draw 400) |

부전승(bye) 경기는 생성 시 자동 확정.

## 순위

| 메서드/경로 | 권한 | 설명 |
|---|---|---|
| `GET <id>/standings/` | 공개 | 순위표: `entrant_id, name, wins/draws/losses, points`(승3·무1), `buchholz`, 아바타. 승점→부흐홀츠→이름순 정렬 |

## 공지·채팅

| 메서드/경로 | 권한 | 설명 |
|---|---|---|
| `GET <id>/announcements/` | 공개 | 공지 목록 (고정 우선) |
| `POST <id>/announcements/` | 주최자 | 공지 작성. body: `content`\*, `pinned`(bool) |
| `DELETE announcements/<id>/` | 주최자 | 공지 삭제 |
| `GET <id>/chat/` | 공개 | 채팅 목록. `?after=<message_id>` 증분 폴링 |
| `POST <id>/chat/` | 참가자·주최자 | 메시지 전송. body: `content` (추방자 불가, 길이 제한) |

## 미구현 (2차)
덱 제출·잠금, 우승 보상(exclusive 테두리 발급), 조별+결선/더블 엘림/스위스 컷, 팀전(Entrant 추상화로 대비됨), 디스코드 알림.
