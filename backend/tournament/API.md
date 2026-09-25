# 대회(Tournament) API 목록

베이스 경로: `/api/tournaments/`
인증: JWT (`Authorization: Bearer <token>`). 표기 없는 엔드포인트는 비로그인 열람 가능.
에러 응답은 공통적으로 `{"error": "<메시지>"}`.

## 대회 관리

| 메서드/경로 | 권한 | 설명 |
|---|---|---|
| `POST create/` | 회원 | 대회 개설. body: `name`\*, `event_date`\*(ISO), `format`\*(`single_elim`·`swiss`·`round_robin`·`swiss_cut`·`group_knockout`·`double_elim`), `capacity`(2~128, 기본 8; 팀전이면 팀 수), `team_size`(1=개인전, 2~5=팀 인원), `description`, `format_config`(스위스 `{"swiss_rounds": 4}`, 스위스컷 `{"cut": 4}`, 조별 `{"groups": 2|4|8, "advance": 1~4}`) → 201 + 상세 |
| `GET ` | 공개 | 대회 목록 (취소 제외, 최신순). `?status=recruiting|ongoing|completed` 필터. 각 항목에 `entrant_count`, `host_name` |
| `GET <id>/` | 공개 | 상세: 대회 정보 + `entrants[]`(아바타 아이콘·테두리 포함) + `rounds[].matches[]` + 주최자 아바타. `md_uid`는 주최자·참가자에게만 값, 그 외 null |
| `PATCH <id>/` | 주최자 | 수정. `name`·`description`·`event_date`는 종료 전 언제나, `capacity`(현재 인원 이상)·`format`·`format_config`는 모집 중에만 |
| `POST <id>/cancel/` | 주최자 | 모집 중·진행 중 대회 취소 → `cancelled` (목록에서 숨김, 신청 불가) |
| `POST <id>/start/` | 주최자 | 모집 마감·1라운드 대진 생성 (체크인 참가자만 착석, 2명 이상 필요). 라운드 시드 저장 |
| `POST <id>/next-round/` | 주최자 | 현재 라운드 전 경기 확정 시 다음 라운드 생성. 형식별 규칙(엘림=승자 진출, 스위스=승점 그룹·재대결 방지·bye, 라운드로빈=사전 일정, 스위스컷=라운드 소진 후 상위 컷 시드, 조별=조 일정 소진 후 각 조 상위 N명을 1위끼리→2위끼리 순으로 시드해 결선). 더블 엘림=승자조 승자 진출 + 패자조(생존자>대기 탈락자면 생존자끼리, 아니면 역순 매칭) + 최종전(패자조 우승자가 이기면 리셋 1회)). 경기의 `group`은 조 index(0=A조), `bracket`은 더블 엘림에서 `winners`/`losers`/`final`, 그 외 빈 문자열. 남은 라운드 없으면 400 |
| `POST <id>/complete/` | 주최자 | 전 경기 확정 시 대회 종료 |

## 모집·참가

| 메서드/경로 | 권한 | 설명 |
|---|---|---|
| `POST <id>/register/` | 회원 | 참가 신청. body: `md_uid`(9자리 숫자) — 프로필에 저장돼 다음 대회부턴 생략 가능. 중복/정원 초과/모집 종료 시 400. 기권자는 같은 자리로 재신청 |
| `POST <id>/withdraw/` | 참가자 | 기권. 진행 중이면 현재 라운드 미확정 경기는 상대 승으로 확정되고 이후 라운드에서 짝이 될 사람은 부전승 |
| `POST <id>/check-in/` | 참가자 | 체크인 (신청 상태에서만, 모집 중에만) |
| `POST <id>/kick/` | 주최자 | 참가자 추방. body: `entrant_id`. 진행 중이면 기권과 같이 처리 |

## 팀전 (`team_size` ≥ 2)

| 메서드/경로 | 권한 | 설명 |
|---|---|---|
| `POST <id>/register/` | 회원 | body: `team_name`\*, `md_uid` → 팀 생성(팀장). 응답에 `join_code`(6자리) |
| `POST <id>/team/join/` | 회원 | body: `code`\*, `md_uid` → 팀 합류. 한 대회에 한 팀만, 정원·체크인 팀은 불가 |
| `POST <id>/team/leave/` | 팀원 | 모집 중에만. 팀장이 나가면 다음 순서가 팀장, 마지막 사람이 나가면 팀 기권 처리 |
| `POST <id>/team/order/` | 팀장 | body: `members`(팀원 id 순서) → 기본 출전 순서 |
| `POST <id>/check-in/` | 팀장 | 팀원이 `team_size`명 모여야 가능 |
| `POST <id>/withdraw/` | 팀장 | 팀 전체 기권 |
| `POST matches/<id>/lineup/` | 팀장 | body: `members` → 이 경기 내 쪽 보드 순서. 보드 보고가 하나라도 시작되면 불가 |
| `POST boards/<id>/report/` | 보드 선수 | body: `result`(win/lose). 보드는 무승부 없음 |
| `POST boards/<id>/confirm/` · `dispute/` | 상대 선수 | 보고 확인 / 이의 |
| `POST boards/<id>/override/` | 주최자 | body: `result`(p1/p2) |

팀 경기(`Match`)는 보드가 모두 확정되면 자동 확정: 보드 다수결. 동률은 리그·스위스에서 무승부, 결선에서는 미확정으로 남아 주최자가 `matches/<id>/override/`로 판정. 팀전에서 `matches/<id>/report/`는 400. 상세의 `entrants[].members[]`(아바타·팀장·순서, UID는 주최자·참가자에게만), `entrants[].join_code`는 본인 팀·주최자에게만. `rounds[].matches[].boards[]`에 보드 정보. 채팅은 `?team=1`/body `team: true`로 팀 전용 채널(팀원만). 덱 제출은 팀원 단위(`GET deck/?member_id=`: 본인·팀장·주최자).

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
| `GET <id>/standings/` | 공개 | 순위표: `entrant_id, name, wins/draws/losses, points`(승3·무1), `buchholz`, `group`(조 index, 조별 형식 외 null), `qualified`(결선 착석 여부), `dropped`(착석 후 기권·추방, 맨 아래로), 아바타. 기권 여부→결선 성적→승점→부흐홀츠→이름순 정렬 |

## 덱 제출 (스캐너 + 수동 보정)

| 메서드/경로 | 권한 | 설명 |
|---|---|---|
| `POST <id>/deck/` | 참가자 | 덱 스크린샷 업로드(multipart `image`) → 스캐너가 카드 자동 인식·목록화(수량 합산, 카드당 최대 3장, 매 업로드마다 목록 교체). 응답에 `cards[]`(카드·수량·신뢰도·auto/manual)와 `unmatched_count`(미인식 수) |
| `GET <id>/deck/` | 본인·주최자 | 내 제출 덱 조회. 주최자는 `?entrant_id=`로 타인 것 열람. 미제출 시 404. `locked`(모집 종료 후 true) 포함 |
| `POST <id>/deck/cards/` | 참가자 | 수동 추가/수정. body: `card_id`(카드 검색 API의 id), `quantity`(1~3). 같은 카드는 수량 갱신 |
| `DELETE <id>/deck/cards/<row_id>/` | 참가자 | 카드 한 줄 삭제 |

덱 수정은 **모집 중에만** 가능 — 대회 시작과 동시에 잠깁니다. 카드 검색은 기존 `/api/search/?q=` 재사용.

## 공지·채팅

| 메서드/경로 | 권한 | 설명 |
|---|---|---|
| `GET <id>/announcements/` | 공개 | 공지 목록 (고정 우선) |
| `POST <id>/announcements/` | 주최자 | 공지 작성. body: `content`\*, `pinned`(bool) |
| `DELETE announcements/<id>/` | 주최자 | 공지 삭제 |
| `GET <id>/chat/` | 공개 | 채팅 목록. `?after=<message_id>` 증분 폴링 |
| `POST <id>/chat/` | 참가자·주최자 | 메시지 전송. body: `content` (추방자 불가, 길이 제한) |

## 미구현 (2차)
디스코드 알림. 팀전 결선 동률의 에이스전(현재는 주최자 판정). 우승 보상은 사이트가 지급하지 않음(주최자 몫).
