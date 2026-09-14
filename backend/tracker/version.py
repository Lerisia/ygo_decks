"""PC tracker client version gate.

Bump LATEST whenever a new mdtracker.exe is published; the site then nudges users whose
client reported an older version (or none at all, which means a build from before version
reporting existed).
"""

LATEST = "0.3.3"
MIN_SUPPORTED = "0.3.3"
DOWNLOAD_URL = "https://ygodecks.com/media/tracker/mdtracker.exe"


def parse(v):
    try:
        return tuple(int(x) for x in str(v).strip().split(".")[:3])
    except (TypeError, ValueError):
        return ()


def is_outdated(v, target=LATEST):
    p = parse(v)
    return not p or p < parse(target)
