# 덱리 게시판 API (decklists)

모든 덱 리스트는 게시판 글입니다(엘리스 2026-10-17: 마이덱 없음). 도감 덱 분류는 두지 않습니다(덱 이름이 테마를 말함, 엘리스 2026-10-18). 응답 모양은 문의 게시판과 같습니다
(목록은 `results`·`total`·`page`·`pages`, 오류는 `{"error": "…"}`). 주소는 `/api/decklists/…`.

## 목록 — `GET /api/decklists/`  (누구나)
남의 비공개 덱은 빠지고, 내 비공개 덱은 보입니다(`is_private: true`). 쿼리: `page`(20개씩), `sort=new`(기본, 올린 순)·`top`(추천순),
`banlist=md|ocg|tcg|custom|none`(금제 종류), `author=<닉네임>`, `card=<카드 id>`(그 카드가 든 덱),
`q=<덱 이름 일부>`. 수정해도 순서는 처음 올린 때 기준.

행(row):
```json
{"code": "a1b2c3d4", "name": "…", "description": "…", "kind": "own",
 "main_count": 40, "extra_count": 15, "cover_cards": [id…], "cover_copies": [0…], "banlist": "md",
 "author": {"name": "닉네임", "avatar_icon": {…}, "border": {…}},
 "is_private": false,
 "like_count": 0, "view_count": 0, "comment_count": 0, "liked": false, "mine": false,
 "created_at": "…", "updated_at": "…"}
```
`avatar_icon`·`border`는 대회 API의 모양과 같습니다(닉네임 옆에 아이콘+프레임을 늘 같이 그립니다).

## 글 하나 — `GET /api/decklists/<code>/`  (누구나; 대회 제출 사본과 비공개 덱은 주인만, 남에겐 404)
행 + `main`, `extra`(카드 id, 한 장마다 하나), `looks`, `issues`(금제 초과·미출시 문장들),
`comments`: `[{"id", "author": {…}, "body", "created_at", "mine"}]`. 주인이 아닌 사람이 열면 조회수가 1 오릅니다
(같은 사람은 6시간에 한 번).

## 올리기 — `POST /api/decklists/`  (로그인)
```json
{"name": "40자", "description": "2,000자", "main": [id…], "extra": [id…],
 "looks": {…}, "cover_cards": [], "cover_copies": [], "banlist": "md", "is_private": false}
```
- `is_private: true`면 비공개(엘리스 2026-10-17): 글쓴이만 보고, 남에겐 게시판·주소·추천·댓글 모두 없는 글입니다. 안 보내면
  새 덱은 공개, 고칠 때는 전과 같습니다.
- 메인 60장, 엑스트라 15장, 같은 이름 3장, 토큰 불가 — 어기면 400.
- 메인 40장 미만(엘리스 2026-10-18: 저장됨), 금제 초과, 미출시는 저장되고 `issues`로만 알립니다. 40장 미만은 화면에
  「40장 미만」 경고를 답니다(`main_count`로 판단).
- 10분에 5개·하루 30개 넘게 올리면 429. 1인 300개.
- 응답 201 = 글 하나와 같은 모양.

## 고치기·지우기 — `PUT` / `DELETE /api/decklists/<code>/`
- PUT은 글쓴이만(본문은 올리기와 같음; 안 보낸 칸은 전과 같이 둡니다). 응답은 글 하나와 같은 모양.
- DELETE는 글쓴이나 운영자, 204. 운영자가 남의 글을 지우면 LogEntry에 남습니다.

## 추천 — `POST /api/decklists/<code>/like/`  (로그인)
켜고 끄기. → `{"liked": true, "like_count": 3}`. 내 글에는 400.

## 댓글
- `POST /api/decklists/<code>/comments/` `{"body": "3,000자"}` → 201 댓글 하나. 글쓴이에게 사이트 알림이 갑니다
  (kind `deck_list_comment`, 링크 `/decklists/<code>`). 10분에 15개·하루 100개 넘으면 429.
- `DELETE /api/decklists/comments/<id>/` 쓴 사람이나 운영자, 204.

## 아직 없는 것
내보내기·가져오기(텍스트·ydk), 커스텀 금제(`custom:<code>`는 지금 모두 "없는 금제 코드"), 신고.
