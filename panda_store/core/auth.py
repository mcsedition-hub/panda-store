import json

from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.http import require_GET, require_POST

from .models import User


def session_response(request):
    user = request.user
    return JsonResponse(
        {
            "user": {"id": str(user.pk), "username": user.username}
            if user.is_authenticated
            else None,
            "csrf_token": get_token(request),
            "demo_mode": settings.PANDA_DEMO_MODE,
            "local_access": settings.PANDA_LOCAL_ACCESS,
        }
    )


@require_GET
def session(request):
    return session_response(request)


@require_POST
@csrf_protect
def enter_local_workspace(request):
    if not settings.PANDA_LOCAL_ACCESS:
        return JsonResponse({"error": "Local access is disabled."}, status=403)
    if request.user.is_authenticated:
        return session_response(request)
    # Reuse the configured workspace account, never an arbitrary user or admin.
    user = User.objects.filter(
        username=settings.PANDA_LOCAL_USERNAME,
        is_active=True,
        is_staff=False,
        is_superuser=False,
    ).first()
    if user is None:
        return JsonResponse(
            {"error": "The local workspace is not ready. Run python manage.py seed_demo."},
            status=503,
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
