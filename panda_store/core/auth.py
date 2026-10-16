import json

from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.http import require_GET, require_POST


@require_GET
def session(request):
    user = request.user
    return JsonResponse(
        {
            "user": {"id": str(user.pk), "username": user.username}
            if user.is_authenticated
            else None,
            "csrf_token": get_token(request),
            "demo_mode": settings.PANDA_DEMO_MODE,
        }
    )


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
        return JsonResponse({"error": "Identifiants invalides."}, status=400)
    user = authenticate(request, username=username, password=password)
    if user is None:
        return JsonResponse({"error": "Identifiant ou mot de passe incorrect."}, status=401)
    login(request, user)
    return JsonResponse(
        {
            "user": {"id": str(user.pk), "username": user.username},
            "csrf_token": get_token(request),
            "demo_mode": settings.PANDA_DEMO_MODE,
        }
    )


@require_POST
@csrf_protect
def sign_out(request):
    logout(request)
    return JsonResponse({"user": None, "csrf_token": get_token(request)})
