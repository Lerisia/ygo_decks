from .models import BannedWord, User


def contains_banned_word(username):
    lower = username.lower()
    for word in BannedWord.objects.values_list("word", flat=True):
        if word.lower() in lower:
            return True
    return False


def generate_safe_username():
    base = "불건전한닉네임"
    n = 0
    while True:
        candidate = f"{base}{n}" if n > 0 else base
        if not User.objects.filter(username=candidate).exists():
            return candidate
        n += 1


def sanitize_username(username):
    if contains_banned_word(username):
        return generate_safe_username()
    return username
