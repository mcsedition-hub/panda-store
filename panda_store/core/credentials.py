"""Installation-owned encryption keys, separate from Django's session signing key."""

from cryptography.fernet import Fernet, InvalidToken, MultiFernet
from django.conf import settings
from rest_framework.exceptions import APIException


class CredentialsUnavailable(APIException):
    status_code = 503
    default_detail = (
        "Credential storage is unavailable. Ask the administrator to check PANDA_CREDENTIAL_KEYS."
    )


def cipher():
    try:
        return MultiFernet([Fernet(key) for key in settings.PANDA_CREDENTIAL_KEYS])
    except (ValueError, TypeError):
        raise CredentialsUnavailable() from None


def credentials_ready():
    try:
        cipher()
        return True
    except CredentialsUnavailable:
        return False


def encrypt(value):
    return cipher().encrypt(value.encode()).decode()


def decrypt(value):
    try:
        return cipher().decrypt(value.encode()).decode()
    except (InvalidToken, UnicodeError):
        raise CredentialsUnavailable() from None
