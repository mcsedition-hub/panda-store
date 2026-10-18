import json
import re

from cryptography.exceptions import UnsupportedAlgorithm
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from rest_framework import serializers

from ..models import GooglePlayConnection

PACKAGE_PATTERN = r"[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+"
TOKEN_URL = "https://oauth2.googleapis.com/token"


class AppImportInput(serializers.Serializer):
    package_name = serializers.RegexField(rf"^{PACKAGE_PATTERN}$", max_length=200)


class ConnectionInput(AppImportInput):
    name = serializers.CharField(max_length=100)
    service_account_json = serializers.CharField(max_length=32768, write_only=True)
    dedicated_account = serializers.BooleanField()
    revision = serializers.UUIDField(required=False, allow_null=True)

    def validate_dedicated_account(self, value):
        if not value:
            raise serializers.ValidationError("Use a service account dedicated to Panda Store.")
        return value

    def validate_service_account_json(self, value):
        try:
            data = json.loads(value)
            if (
                not isinstance(data, dict)
                or data.get("type") != "service_account"
                or data.get("token_uri") != TOKEN_URL
                or not re.fullmatch(
                    r"[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.iam\.gserviceaccount\.com",
                    data.get("client_email", ""),
                )
                or len(data["client_email"]) > 254
                or not re.fullmatch(r"[A-Za-z0-9_-]{1,200}", data.get("private_key_id", ""))
                or not re.fullmatch(r"[A-Za-z0-9-]{1,200}", data.get("project_id", ""))
            ):
                raise ValueError()
            key = serialization.load_pem_private_key(data["private_key"].encode(), password=None)
            if not isinstance(key, rsa.RSAPrivateKey) or key.key_size < 2048:
                raise ValueError()
        except (ValueError, TypeError, KeyError, AttributeError, UnsupportedAlgorithm):
            raise serializers.ValidationError(
                "Upload a Google service account JSON key with an unencrypted RSA private key. "
                "A Gemini API key or OAuth client JSON is not a Play Console credential."
            ) from None
        # Never use URLs or delegation settings supplied by a credential file.
        return {
            k: data[k]
            for k in (
                "type",
                "client_email",
                "project_id",
                "private_key_id",
                "private_key",
                "token_uri",
            )
        }


class ConnectionSerializer(serializers.ModelSerializer):
    class Meta:
        model = GooglePlayConnection
        fields = [
            "id",
            "name",
            "client_email",
            "project_id",
            "verified_package",
            "revision",
            "created_at",
            "last_checked_at",
        ]
