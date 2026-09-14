"""Passwords must be typable. A generated password can carry bytes that no text field
accepts, and the account then works nowhere but the browser that stored it."""
import unicodedata

from django.core.exceptions import ValidationError


def validate_password_characters(password):
    if not password:
        raise ValidationError("비밀번호를 입력해주세요.")
    if password != password.strip():
        raise ValidationError("비밀번호는 공백으로 시작하거나 끝날 수 없습니다.")
    if any(unicodedata.category(ch)[0] == "C" for ch in password):
        raise ValidationError("비밀번호에 화면에 보이지 않는 문자가 들어 있습니다. 눈에 보이는 문자만 사용해주세요.")
    return password
