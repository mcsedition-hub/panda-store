import json

from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from django.core.exceptions import ValidationError
from django.db import IntegrityError
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.http import require_GET, require_POST

from .onboarding import SetupSerializer, configure_installation, setup_available


def session_response(request):
    user = request.user
    return JsonResponse(
        {
            "user": {"id": str(user.pk), "username": user.username}
            if user.is_authenticated
            else None,
            "csrf_token": get_token(request),
            "demo_mode": settings.PANDA_DEMO_MODE,
            "setup_required": setup_available(),
        }
    )


@require_GET
def session(request):
    return session_response(request)


@require_POST
@csrf_protect
def setup(request):
    if not setup_available():
        return JsonResponse({"error": "Setup is unavailable or already complete."}, status=409)
    try:
        data = json.loads(request.body)
    except (ValueError, UnicodeDecodeError):
        return JsonResponse({"error": "Invalid setup details."}, status=400)
    serializer = SetupSerializer(data=data)
    if not serializer.is_valid():
        return JsonResponse({"error": serializer.errors}, status=400)
    try:
        user = configure_installation(serializer.validated_data)
    except (IntegrityError, ValidationError):
        return JsonResponse(
            {"error": "Setup has changed or is already complete. Refresh to continue."},
            status=409,
        )
    login(request, user, backend="django.contrib.auth.backends.ModelBackend")
    return session_response(request)


@require_POST
@csrf_protect
def sign_in(request):
    # Django's CSRF middleware also protects anonymous login attempts.
    try:
        data = json.loads(request.body)
        username, password = data.get("username", ""), data.get("password", "")
        if not isinstance(username, str) or not isinstance(password, str):
            raise ValueError
        if len(username) > 150 or len(password) > 1024:
            raise ValueError
    except (ValueError, AttributeError):
        return JsonResponse({"error": "Invalid credentials."}, status=400)
    user = authenticate(request, username=username, password=password)
    if user is None:
        return JsonResponse({"error": "Incorrect username or password."}, status=401)
    login(request, user)
    return session_response(request)


@require_POST
@csrf_protect
def sign_out(request):
    logout(request)
    return JsonResponse({"user": None, "csrf_token": get_token(request)})
