import asyncio
import json
import time

from asgiref.sync import sync_to_async
from django.core.serializers.json import DjangoJSONEncoder
from django.db import transaction
from django.http import StreamingHttpResponse
from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view, renderer_classes
from rest_framework.exceptions import ValidationError
from rest_framework.renderers import JSONRenderer
from rest_framework.response import Response

from panda_store.ai.usage import totals
from panda_store.core.access import workspace_access
from panda_store.core.models import AIUsage

from .models import WorkflowRun
from .services import cancel, recover


class EventStreamRenderer(JSONRenderer):
    # DRF negotiates the EventSource Accept header before returning the stream.
    # Error responses keep a safe JSON body with their non-2xx status.
    media_type = "text/event-stream"
    format = "event-stream"


def access(user, workspace_id, run_id, *, write=False):
    workspace_access(user, workspace_id, write=write)
    run = get_object_or_404(WorkflowRun, pk=run_id, workspace_id=workspace_id)
    workspace_access(user, workspace_id, write=write, module=run.module_id)
    return run


def cursor(request):
    try:
        value = int(request.headers.get("Last-Event-ID") or request.GET.get("after", "0"))
        if not 0 <= value <= 2_147_483_647:
            raise ValueError
        return value
    except (TypeError, ValueError) as exc:
        raise ValidationError("Invalid event cursor.") from exc


def snapshot(user, workspace_id, run_id, after):
    run = access(user, workspace_id, run_id)
    recover(run.pk)
    # Keep state, steps and the event cursor consistent on READ COMMITTED PostgreSQL.
    with transaction.atomic():
        run = WorkflowRun.objects.select_for_update().get(pk=run.pk)
        events = list(
            run.events.filter(sequence__gt=after).values(
                "sequence", "step_key", "kind", "message", "created_at"
            )[:100]
        )
        next_cursor = events[-1]["sequence"] if events else min(after, run.event_sequence)
        return {
            "ai_usage": totals(
                AIUsage.objects.filter(workspace_id=workspace_id, workflow_id=run.pk)
            ),
            "id": str(run.pk),
            "title": run.title,
            "status": run.status,
            "created_at": run.created_at,
            "started_at": run.started_at,
            "completed_at": run.completed_at,
            "heartbeat_at": run.heartbeat_at,
            "error": run.error,
            "retry_of": str(run.retry_of_id) if run.retry_of_id else None,
            "steps": list(
                run.steps.values(
                    "id",
                    "key",
                    "title",
                    "kind",
                    "depends_on",
                    "status",
                    "summary",
                    "started_at",
                    "completed_at",
                    "reused_from_id",
                )
            ),
            "events": events,
            "cursor": next_cursor,
            "has_more": next_cursor < run.event_sequence,
        }


@api_view(["GET"])
def detail(request, workspace_id, run_id):
    return Response(snapshot(request.user, workspace_id, run_id, cursor(request)))


@api_view(["POST"])
def stop(request, workspace_id, run_id):
    access(request.user, workspace_id, run_id, write=True)
    cancel(run_id)
    return Response(snapshot(request.user, workspace_id, run_id, 0))


@api_view(["GET"])
@renderer_classes([EventStreamRenderer])
def events(request, workspace_id, run_id):
    after = cursor(request)
    access(request.user, workspace_id, run_id)

    def frame(data):
        payload = json.dumps(data, cls=DjangoJSONEncoder)
        return f"id: {data['cursor']}\nevent: update\ndata: {payload}\n\n"

    def read(position):
        # Recheck access on every batch, including after module/role changes.
        return snapshot(request.user, workspace_id, run_id, position)

    def done(data):
        return data["status"] in {"succeeded", "failed", "canceled"} and not data["has_more"]

    async def async_stream():
        position = after
        deadline = time.monotonic() + 25
        while time.monotonic() < deadline:
            try:
                data = await sync_to_async(read)(position)
            except Exception:
                yield "event: unavailable\ndata: {}\n\n"
                return
            yield frame(data)
            position = data["cursor"]
            if done(data):
                return
            if not data["has_more"]:
                await asyncio.sleep(1)

    def sync_stream():
        # Development runserver / WSGI compatibility; Compose uses ASGI.
        position = after
        deadline = time.monotonic() + 25
        while time.monotonic() < deadline:
            try:
                data = read(position)
            except Exception:
                yield "event: unavailable\ndata: {}\n\n"
                return
            yield frame(data)
            position = data["cursor"]
            if done(data):
                return
            if not data["has_more"]:
                time.sleep(1)

    is_async = hasattr(request._request, "scope")
    response = StreamingHttpResponse(
        async_stream() if is_async else sync_stream(), content_type="text/event-stream"
    )
    response["Cache-Control"] = "no-store"
    response["X-Accel-Buffering"] = "no"
    return response
