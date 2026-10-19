from panda_store.workflows.services import create_run

VERSION = 1
AI_VERSION = 2
VISUAL_VERSION = 1
PROJECT_VERSION = 1
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
        "key": "grounding",
        "title": "Check claims against listing",
        "kind": "ai",
        "depends_on": ["validate"],
    },
    {
        "key": "report",
        "title": "Save recommendations",
        "kind": "storage",
        "depends_on": ["grounding"],
    },
]
VISUAL_STEPS = STEPS[:1] + [
    {
        "key": "images",
        "title": "Save screenshot evidence",
        "kind": "storage",
        "depends_on": ["listing"],
    },
    {"key": "visual", "title": "Review screenshots", "kind": "ai", "depends_on": ["images"]},
    {
        "key": "verify_visual",
        "title": "Check visual evidence",
        "kind": "ai",
        "depends_on": ["visual"],
    },
    {"key": "report", "title": "Save findings", "kind": "storage", "depends_on": ["verify_visual"]},
]
RUNNERS = {
    "aso.audit": (VERSION, execute),
    "aso.editorial": (AI_VERSION, execute),
    "aso.visual": (VISUAL_VERSION, execute),
    "aso.project": (PROJECT_VERSION, execute),
}

PROJECT_STEPS = [
    {"key": "project", "title": "Read app idea", "kind": "validation", "depends_on": []},
    {
        "key": "strategy",
        "title": "Analyze positioning and propose listing",
        "kind": "ai",
        "depends_on": ["project"],
    },
    {
        "key": "validate_project",
        "title": "Check listing limits and references",
        "kind": "validation",
        "depends_on": ["strategy"],
    },
    {
        "key": "verify_project",
        "title": "Check claims against app idea",
        "kind": "ai",
        "depends_on": ["validate_project"],
    },
    {
        "key": "report",
        "title": "Save ASO proposal",
        "kind": "storage",
        "depends_on": ["verify_project"],
    },
]


def create_workflow(
    workspace,
    user,
    retry_of=None,
    ai=False,
    screenshots=False,
    project=False,
    reuse_steps=None,
    platform="ios",
):
    if project:
        return create_run(
            workspace=workspace,
            user=user,
            module_id="aso",
            key="aso.project",
            version=PROJECT_VERSION,
            title="Prepare listing from app idea",
            steps=PROJECT_STEPS,
            retry_of=retry_of,
            reuse_steps=reuse_steps,
        )
    return create_run(
        workspace=workspace,
        user=user,
        module_id="aso",
        key="aso.visual" if screenshots else "aso.editorial" if ai else "aso.audit",
        version=VISUAL_VERSION if screenshots else AI_VERSION if ai else VERSION,
        title="Review screenshots" if screenshots else "Audit store listing",
        steps=[
            {**step, "title": "Check Google Play guidance"}
            if platform == "android" and step["key"] == "checks"
            else step
            for step in (VISUAL_STEPS if screenshots else AI_STEPS if ai else STEPS)
        ],
        retry_of=retry_of,
        reuse_steps=reuse_steps,
    )
