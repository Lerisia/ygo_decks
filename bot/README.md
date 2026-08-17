# Co-op Discord Bot

부운영자가 Discord로 자연어 요청을 보내면, 이 서버에서 `claude` CLI(Claude Code)를 호출해서 코드 수정·commit·push까지 처리하는 봇입니다. **배포(`deploy.sh`)는 절대 봇이 하지 않습니다** — 사장님이 GitHub에서 브랜치 검토 후 merge → deploy.

## 최초 세팅 (사장님 1회)

### 1. Discord bot 생성
1. https://discord.com/developers/applications → **New Application**
2. Bot 탭 → **Reset Token** → 토큰 복사해두기 (채팅에 붙여넣지 말고 아래 3번 `.env`에 바로)
3. Bot 탭 하단 **MESSAGE CONTENT INTENT** 활성화
4. OAuth2 → URL Generator:
   - scopes: `bot`
   - Bot Permissions: `Send Messages`, `Read Message History`, `Add Reactions`, `Embed Links`
   - 생성된 URL을 브라우저에 열어서 사장님 Discord 서버에 초대

### 2. 필요한 ID 수집 (Discord 개발자 모드 필요)
Discord 설정 → 고급 → 개발자 모드 ON. 그다음 우클릭으로 복사:
- **유저 ID**: 사장님 본인 + 부운영자님 각각 (필수)
- **채널 ID**: (선택) 특정 서버 채널에서도 봇을 쓰고 싶을 때만. **DM만 쓸 거면 빈 값**으로 두세요.

#### DM으로 봇을 쓰는 경우 (권장)
- 봇은 아무 DM에나 초대되지 않음 — 대신 **봇과 한 서버라도 공유하면 DM 가능**
- 아무 서버(사장님 프라이빗 서버든, 부운영자님과 이미 있던 서버든)에 봇을 초대만 해두면 됨
- 초대 후 사장님/부운영자님이 봇 프로필 클릭 → "메시지 보내기"로 DM
- `COOP_CHANNEL_ID`는 비워두면 DM만 처리 (외부 유출 걱정 X)

#### 특정 서버 채널을 쓰는 경우
- 봇을 초대한 서버에서 원하는 채널 우클릭 → ID 복사
- `.env`의 `COOP_CHANNEL_ID`에 그 값 입력
- 이 경우에도 DM은 여전히 허용됨 (whitelist된 유저 한정)

### 3. `.env` 파일 작성
```bash
cd /home/elyss/ygo_decks/bot
cp .env.example .env
nano .env
# 아래 값들 채워넣기:
#   DISCORD_BOT_TOKEN=... (Discord Developer Portal에서 복사)
#   COOP_CHANNEL_ID=... (채널 ID)
#   ALLOWED_USER_IDS=사장님ID,부운영자ID
#   ANTHROPIC_API_KEY=sk-ant-... (https://console.anthropic.com/)
```

### 4. Python 가상환경 준비
```bash
cd /home/elyss/ygo_decks/bot
python3 -m venv venv
venv/bin/pip install -r requirements.txt
```

### 5. 로컬 테스트 실행 (systemd 등록 전에)
```bash
cd /home/elyss/ygo_decks/bot
venv/bin/python main.py
```
Discord에 봇이 온라인으로 뜨고, 허용 채널에 허용 유저가 메시지 보내면 반응해야 함. `Ctrl+C`로 종료.

### 6. 배포 권한 세팅 (봇이 배포까지 자율 수행하려면 필수)

봇 프로세스에 sudo 비밀번호를 노출하는 대신, **`deploy.sh`가 부르는 root 전용 스크립트 하나만** 비밀번호 없이 실행 가능하도록 sudoers에 화이트리스트합니다.

```bash
# 1. root 소유의 시스템 경로로 deploy_root.sh 복사 (elyss가 수정 못 하게)
sudo cp /home/elyss/ygo_decks/deploy_root.sh /usr/local/sbin/ygo-deploy-root
sudo chown root:root /usr/local/sbin/ygo-deploy-root
sudo chmod 755 /usr/local/sbin/ygo-deploy-root

# 2. sudoers 화이트리스트 등록 (elyss가 이 스크립트만 비번 없이 실행 가능)
sudo cp /home/elyss/ygo_decks/bot/coop-bot-sudoers /etc/sudoers.d/coop-bot-deploy
sudo chmod 440 /etc/sudoers.d/coop-bot-deploy
sudo visudo -c   # 문법 검증 — 통과해야 함

# 3. 동작 확인
sudo -n /usr/local/sbin/ygo-deploy-root </dev/null 2>&1 | head
# (에러가 나더라도 "sudo: a password is required" 문구가 없으면 OK)
```

### 7. systemd 서비스로 상주
```bash
sudo cp /home/elyss/ygo_decks/bot/coop-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable coop-bot
sudo systemctl start coop-bot
sudo systemctl status coop-bot
```

⚠️ **`deploy_root.sh`를 나중에 수정하면 6-1 단계(sudo cp)를 다시 실행해야 반영**됩니다. 사장님이 직접 편집·재배치하지 않는 이상 자동으로 갱신되지 않아요 (의도적으로 그렇게 설계 — elyss 소유 파일을 root로 실행하면 무의미).

## 운영

### 로그 확인
```bash
sudo journalctl -u coop-bot -f
```

### 재시작 (`.env` 변경 후 등)
```bash
sudo systemctl restart coop-bot
```

### 봇 코드 업데이트 후
```bash
cd /home/elyss/ygo_decks/bot
git pull  # 또는 이 저장소가 갱신되면
sudo systemctl restart coop-bot
```

## 부운영자 사용법 (간단히)

허용 채널에서 자유롭게 메시지:
- "공지 X 버튼이 잘 안 보여요, 좀 진하게 해주세요"
- "낙인 덱을 중상위권으로 옮겨줘"
- "홈 화면 로고 위 여백 좀 줄여주세요"

봇 반응:
1. `🤔 작업 시작...` 답장
2. 진행 중 상태를 주기적으로 업데이트
3. 완료 시 무엇을 했는지 + git 브랜치명·commit 요약
4. 사장님이 GitHub에서 브랜치 확인 → merge → `bash deploy.sh`

## 안전장치

- **sudo/deploy 불가**: systemd unit에 `NoNewPrivileges=true`, sudo 관련 env var 제거
- **화이트리스트만 수신**: 지정 채널의 지정 유저 외 메시지는 무시
- **master 직접 push 금지**: system prompt에서 명시 (Claude가 브랜치 만들도록)
- **타임아웃**: `CLAUDE_TIMEOUT_SEC` 기본 900s. 무한 대기 방지
- **`.env` git 제외**: 루트 `.gitignore`에 `bot/.env` 포함됨

## 비용 관리

- Anthropic Console에서 **월 예산 한도** 설정 권장 (예: $50)
- 부운영자가 요청 하나 던질 때마다 대략 몇 센트~수 달러 소모 (복잡도에 따라)
- 이상 사용량 감지 시 API key 회전 or `sudo systemctl stop coop-bot`으로 즉시 정지

## 문제 해결

**봇이 온라인이 안 됨**
- `sudo journalctl -u coop-bot -n 50` → 토큰 오류/네트워크/import 에러 확인

**"claude: command not found"**
- systemd unit의 `Environment=PATH=...` 경로가 실제 `which claude` 결과와 일치하는지 확인
- nvm 경로가 바뀐 경우 unit 파일의 PATH도 수정 후 `sudo systemctl daemon-reload && sudo systemctl restart coop-bot`

**Claude 응답이 잘림**
- Discord 메시지는 2000자 제한. 봇이 자동으로 잘라서 표시함
- 전체 로그는 `sudo journalctl -u coop-bot`에서 확인 가능
