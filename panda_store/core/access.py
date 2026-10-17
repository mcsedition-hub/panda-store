from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import PermissionDenied, ValidationError

from .models import Membership, ModuleActivation, Workspace
from .registry import get_registry


def workspace_access(user, workspace_id, *, write=False, owner=False, module=None):
    membership = get_object_or_404(
        Membership.objects.select_related("workspace"),
        user=user,
        workspace_id=workspace_id,
    )
    if owner and membership.role != Membership.Role.OWNER:
        raise PermissionDenied("Only the workspace owner can perform this action.")
    if write and membership.role == Membership.Role.VIEWER:
        raise PermissionDenied("This account has read-only access.")
    if module:
        installed = get_registry().modules.get(module)
        if (
            installed is None
            or installed.availability != "available"
            or not membership.workspace.modules.filter(module_id=module).exists()
        ):
            raise PermissionDenied("This module is not enabled in this workspace.")
    return membership.workspace


@transaction.atomic
def activate_modules(workspace, module_ids):
    # Serialize activation changes on PostgreSQL to protect dependency invariants.
    Workspace.objects.select_for_update().get(pk=workspace.pk)
    try:
        registry = get_registry()
        ordered = registry.resolve(module_ids)
    except ValueError as exc:
        raise ValidationError(str(exc)) from exc
    if any(registry.modules[module_id].availability != "available" for module_id in ordered):
        raise ValidationError("This module is planned and cannot be enabled yet.")
    for module_id in ordered:
        ModuleActivation.objects.get_or_create(workspace=workspace, module_id=module_id)
    return ordered


@transaction.atomic
def deactivate_module(workspace, module_id):
    Workspace.objects.select_for_update().get(pk=workspace.pk)
    registry = get_registry()
    module = registry.modules.get(module_id)
    if module is None or module.required:
        raise ValidationError("This module cannot be disabled.")
    enabled = set(workspace.modules.values_list("module_id", flat=True))
    dependents = [m for m in enabled if m != module_id and module_id in registry.resolve([m])]
    if dependents:
        raise ValidationError({"dependencies": sorted(dependents)})
    workspace.modules.filter(module_id=module_id).delete()
