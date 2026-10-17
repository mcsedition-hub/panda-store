from panda_store.workflows.services import create_run

VERSION = 1


def execute(run_id):
    from .models import GenerationRun
    from .tasks import generate_scripts

    run = GenerationRun.objects.get(workflow_id=run_id)
    generate_scripts(str(run.pk))


RUNNERS = {"studio.scripts": (VERSION, execute)}


def research_execute(run_id):
    from .research_tasks import research

    research(str(run_id))


RESEARCH_VERSION = 1
RUNNERS["studio.research"] = (RESEARCH_VERSION, research_execute)
RESEARCH_STEPS = [
    {"key": "context", "title": "Check app and browser", "kind": "validation", "depends_on": []},
    {
        "key": "discover",
        "title": "Search competitors and posts",
        "kind": "search",
        "depends_on": ["context"],
    },
    {
        "key": "browse",
        "title": "Open and scroll sources",
        "kind": "browser",
        "depends_on": ["discover"],
    },
    {"key": "analyze", "title": "Analyze visible examples", "kind": "ai", "depends_on": ["browse"]},
    {
        "key": "verify",
        "title": "Check observations against evidence",
        "kind": "ai",
        "depends_on": ["analyze"],
    },
    {"key": "report", "title": "Save research", "kind": "storage", "depends_on": ["verify"]},
]

STEPS = [
    {"key": "context", "title": "Read app and brief", "kind": "validation", "depends_on": []},
    {
        "key": "scripts",
        "title": "Create three scripts",
        "kind": "template",
        "depends_on": ["context"],
    },
    {"key": "save", "title": "Save for review", "kind": "storage", "depends_on": ["scripts"]},
]


def create_workflow(run, retry_of=None):
    workflow = create_run(
        workspace=run.workspace,
        user=run.created_by,
        module_id="studio",
        key="studio.scripts",
        version=VERSION,
        title="Create scripts",
        steps=STEPS,
        retry_of=retry_of,
    )
    run.workflow = workflow
    run.save(update_fields=["workflow"])
    return workflow
