"""Durable execution state. Callers emit curated facts, never raw provider responses."""

import uuid
from contextlib import contextmanager
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from panda_store.core.models import Workspace

from .models import RunEvent, StepRun, WorkflowRun

LEASE_SECONDS = 45
QUEUE_TIMEOUT_SECONDS = 300


class ExecutionStopped(Exception):
    pass


def _event(run, kind, message, step_key=""):
    # The caller owns the run row lock; sequence allocation and state commit together.
    run.event_sequence += 1
    run.save(update_fields=["event_sequence"])
    RunEvent.objects.create(
        run=run, sequence=run.event_sequence, kind=kind, message=message, step_key=step_key
    )


@transaction.atomic
def create_run(
    *, workspace, user, module_id, key, version, title, steps, retry_of=None, reuse_steps=None
):
    if retry_of and (
        retry_of.workspace_id != workspace.pk
        or retry_of.module_id != module_id
        or retry_of.workflow_key != key
        or retry_of.version != version
    ):
        raise ValueError("A retry must keep the workspace and workflow version.")
    seen = set()
    for step in steps:
        if step["key"] in seen or not set(step.get("depends_on", [])) <= seen:
            raise ValueError("Workflow steps must have unique keys and ordered dependencies.")
        seen.add(step["key"])
    if not steps:
        raise ValueError("A workflow must contain a step.")
    run = WorkflowRun.objects.create(
        workspace=workspace,
        created_by=user,
        module_id=module_id,
        workflow_key=key,
        version=version,
        title=title,
        retry_of=retry_of,
    )
    _event(run, "queued", "Waiting for a worker.")
    previous = {step.key: step for step in retry_of.steps.all()} if retry_of else {}
    reused = set()
    for position, definition in enumerate(steps):
        step = StepRun.objects.create(run=run, position=position, **definition)
        old = previous.get(step.key)
        if (
            old
            and (reuse_steps is None or step.key in reuse_steps)
            and old.status == StepRun.Status.SUCCEEDED
            and set(step.depends_on) <= reused
            and old.kind == step.kind
            and old.depends_on == step.depends_on
        ):
            step.status = old.status
            step.output = old.output
            step.summary = old.summary
            step.started_at = old.started_at
            step.completed_at = old.completed_at
            step.reused_from = old
            step.save()
            reused.add(step.key)
            _event(run, "reused", "Reused the completed step from the previous attempt.", step.key)
    return run


def _finish(run, status, message):
    now = timezone.now()
    run.status = status
    run.completed_at = now
    run.lease_token = None
    run.lease_expires_at = None
    run.error = message if status == WorkflowRun.Status.FAILED else ""
    run.save()
    active_status = (
        StepRun.Status.FAILED if status == WorkflowRun.Status.FAILED else StepRun.Status.CANCELED
    )
    for step in run.steps.filter(status__in=[StepRun.Status.RUNNING, StepRun.Status.QUEUED]):
        step.status = (
            active_status if step.status == StepRun.Status.RUNNING else StepRun.Status.SKIPPED
        )
        step.completed_at = now
        step.summary = message if step.status != StepRun.Status.SKIPPED else "Not executed."
        step.save()
    _event(run, status, message)


@transaction.atomic
def claim(run_id):
    workspace_id = WorkflowRun.objects.values_list("workspace_id", flat=True).get(pk=run_id)
    workspace = Workspace.objects.select_for_update().get(pk=workspace_id)
    run = WorkflowRun.objects.select_for_update().get(pk=run_id)
    if run.status != WorkflowRun.Status.QUEUED:
        return None
    if not workspace.modules.filter(module_id=run.module_id).exists():
        _finish(
            run, WorkflowRun.Status.FAILED, "This module was disabled before the workflow started."
        )
        return None
    run.status = WorkflowRun.Status.RUNNING
    run.started_at = run.heartbeat_at = timezone.now()
    run.lease_expires_at = run.heartbeat_at + timedelta(seconds=LEASE_SECONDS)
    run.lease_token = uuid.uuid4()
    run.save()
    _event(run, "started", "Workflow started.")
    return run.lease_token


@contextmanager
def execution_lock(run_id, token):
    with transaction.atomic():
        run = WorkflowRun.objects.select_for_update().get(pk=run_id)
        if (
            run.status != WorkflowRun.Status.RUNNING
            or run.lease_token != token
            or run.lease_expires_at <= timezone.now()
        ):
            raise ExecutionStopped()
        yield run


def heartbeat(run_id, token):
    now = timezone.now()
    # Canceling deliberately stops extending the lease. A hung call eventually expires.
    return WorkflowRun.objects.filter(
        pk=run_id,
        lease_token=token,
        status=WorkflowRun.Status.RUNNING,
        lease_expires_at__gt=now,
    ).update(heartbeat_at=now, lease_expires_at=now + timedelta(seconds=LEASE_SECONDS))


def start_step(run_id, token, key, message):
    with execution_lock(run_id, token) as run:
        step = run.steps.get(key=key)
        if step.status == StepRun.Status.SUCCEEDED:
            return step.output
        completed = set(
            run.steps.filter(status=StepRun.Status.SUCCEEDED).values_list("key", flat=True)
        )
        if step.status != StepRun.Status.QUEUED or not set(step.depends_on) <= completed:
            raise ValueError("The step is not ready to run.")
        step.status = StepRun.Status.RUNNING
        step.started_at = timezone.now()
        step.summary = message
        step.save()
        _event(run, "step_started", message, key)
    return None


def complete_step(run_id, token, key, message, output=None):
    with execution_lock(run_id, token) as run:
        step = run.steps.get(key=key, status=StepRun.Status.RUNNING)
        step.status = StepRun.Status.SUCCEEDED
        step.completed_at = timezone.now()
        step.summary = message
        step.output = output
        step.save()
        _event(run, "step_completed", message, key)


def progress(run_id, token, key, message):
    """Emit a factual milestone within an active step, fenced like all other writes."""
    with execution_lock(run_id, token) as run:
        run.steps.get(key=key, status=StepRun.Status.RUNNING)
        _event(run, "progress", message[:300], key)


def succeed(run_id, token, message="Workflow completed."):
    with execution_lock(run_id, token) as run:
        if run.steps.exclude(status=StepRun.Status.SUCCEEDED).exists():
            raise ValueError("All steps must finish before the workflow can complete.")
        _finish(run, WorkflowRun.Status.SUCCEEDED, message)


@transaction.atomic
def fail(run_id, message, token=None):
    run = WorkflowRun.objects.select_for_update().get(pk=run_id)
    if run.terminal or (token is not None and run.lease_token != token):
        return
    if run.status == WorkflowRun.Status.CANCELING:
        _finish(run, WorkflowRun.Status.CANCELED, "Workflow stopped.")
    else:
        _finish(run, WorkflowRun.Status.FAILED, message)


@transaction.atomic
def cancel(run_id):
    run = WorkflowRun.objects.select_for_update().get(pk=run_id)
    if run.terminal or run.status == WorkflowRun.Status.CANCELING:
        return
    if run.status == WorkflowRun.Status.QUEUED:
        _finish(run, WorkflowRun.Status.CANCELED, "Canceled before the workflow started.")
    else:
        run.status = WorkflowRun.Status.CANCELING
        run.save(update_fields=["status"])
        _event(run, "cancel_requested", "Stop requested. Waiting for the current action to finish.")


@transaction.atomic
def recover(run_id):
    run = WorkflowRun.objects.select_for_update().get(pk=run_id)
    now = timezone.now()
    if run.status == WorkflowRun.Status.QUEUED:
        if run.created_at < now - timedelta(seconds=QUEUE_TIMEOUT_SECONDS):
            _finish(
                run,
                WorkflowRun.Status.FAILED,
                "No worker started this workflow. Start the worker and retry.",
            )
    elif run.status in {WorkflowRun.Status.RUNNING, WorkflowRun.Status.CANCELING}:
        if run.lease_expires_at and run.lease_expires_at <= now:
            if run.status == WorkflowRun.Status.CANCELING:
                _finish(
                    run, WorkflowRun.Status.CANCELED, "Stopped after the worker stopped responding."
                )
            else:
                _finish(
                    run,
                    WorkflowRun.Status.FAILED,
                    "The worker stopped responding. Retry the unfinished steps.",
                )
