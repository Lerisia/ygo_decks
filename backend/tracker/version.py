"""PC recorder (formerly "tracker") client version gate.

Bump LATEST whenever a new build is published; the site then nudges users whose client reported an older version
(or none at all, which means a build from before version reporting existed).

1.0.0 (2026-09-28) is the first release: it records duels and shows nothing about the opponent's cards. Every 0.x
build was the beta, and the beta showed cards during a duel — so none of them is let in any more, whoever runs it.
"""

LATEST = "1.0.2"
MIN_SUPPORTED = "1.0.0"  # builds below this are refused by TrackerVersionGate, the thumbnail view and the test-build unlock
GATE_EXEMPT_USER_IDS = set()  # nobody keeps an old build; a test build gets in on its version (1.0.0-test → 1.0.0)
TEST_ACCOUNT_IDS = {1, 170, 508}  # 엘리스, 블이수, 특이점: accounts whose test builds may send whole captures
DOWNLOAD_URL = "https://ygodecks.com/media/recorder/YGODecksRecorder.exe"


def parse(v):
    try:
        return tuple(int(x) for x in str(v).strip().split("-")[0].split(".")[:3])
    except (TypeError, ValueError):
        return ()


def is_outdated(v, target=LATEST):
    p = parse(v)
    return not p or p < parse(target)


def is_test_build(v):
    return "-test" in str(v or "")
