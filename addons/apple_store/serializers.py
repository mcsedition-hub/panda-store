from cryptography.exceptions import UnsupportedAlgorithm
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from rest_framework import serializers

from .models import AppleConnection


class ConnectionInput(serializers.Serializer):
    name = serializers.CharField(max_length=100)
    key_type = serializers.ChoiceField(choices=["team", "individual"])
    key_id = serializers.RegexField(r"^[A-Z0-9]{10}$", max_length=10)
    issuer_id = serializers.UUIDField(required=False, allow_null=True)
    private_key = serializers.CharField(max_length=16384, write_only=True)

    def validate_private_key(self, value):
        try:
            key = serialization.load_pem_private_key(value.encode(), password=None)
            if not isinstance(key, ec.EllipticCurvePrivateKey) or not isinstance(
                key.curve, ec.SECP256R1
            ):
                raise ValueError()
        except (ValueError, TypeError, UnsupportedAlgorithm):
            raise serializers.ValidationError(
                "Choose an unencrypted Apple .p8 API key (ES256)."
            ) from None
        return key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ).decode()

    def validate(self, data):
        issuer = data.get("issuer_id")
        if data["key_type"] == "team" and not issuer:
            raise serializers.ValidationError(
                {"issuer_id": "An Issuer ID is required for a team key."}
            )
        if data["key_type"] == "individual" and issuer:
            raise serializers.ValidationError(
                {"issuer_id": "An individual key does not use an Issuer ID."}
            )
        data["issuer_id"] = str(issuer) if issuer else ""
        return data


class ConnectionSerializer(serializers.ModelSerializer):
    class Meta:
        model = AppleConnection
        fields = ["id", "name", "key_type", "key_id", "issuer_id", "created_at", "last_checked_at"]


class AppImportInput(serializers.Serializer):
    external_id = serializers.RegexField(r"^[0-9]{1,30}$")


class CatalogQuery(serializers.Serializer):
    cursor = serializers.CharField(max_length=4096, required=False)
