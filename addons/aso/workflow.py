from panda_store.workflows.services import create_run

VERSION = 1
STEPS = [
    {"key": "listing", "title": "Read saved listing", "kind": "validation", "depends_on": []},
    {"key": "checks", "title": "Check Apple guidance", "kind": "rules", "depends_on": ["listing"]},
    {"key": "report", "title": "Save findings", "kind": "storage", "depends_on": ["checks"]},
]


def execute(run_id):
    from .tasks import audit_listing

    audit_listing(str(run_id))


AI_STEPS = STEPS[:2] + [
    {"key": "editorial", "title": "Review copy with AI", "kind": "ai", "depends_on": ["checks"]},
    {
        "key": "validate",
        "title": "Validate proposals",
        "kind": "validation",
        "depends_on": ["editorial"],
    },
    {
        "key": "report",
        "title": "Save recommendations",
        "kind": "storage",
        "depends_on": ["validate"],
    },
]
RUNNERS = {"aso.audit": (VERSION, execute), "aso.editorial": (VERSION, execute)}


def create_workflow(workspace, user, retry_of=None, ai=False):
    return create_run(
        workspace=workspace,
        user=user,
        module_id="aso",
        key="aso.editorial" if ai else "aso.audit",
        version=VERSION,
        title="Audit store listing",
        steps=AI_STEPS if ai else STEPS,
        retry_of=retry_of,
    )
