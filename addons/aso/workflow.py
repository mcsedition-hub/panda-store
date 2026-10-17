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


RUNNERS = {"aso.audit": (VERSION, execute)}


def create_workflow(workspace, user, retry_of=None):
    return create_run(
        workspace=workspace,
        user=user,
        module_id="aso",
        key="aso.audit",
        version=VERSION,
        title="Audit store listing",
        steps=STEPS,
        retry_of=retry_of,
    )
