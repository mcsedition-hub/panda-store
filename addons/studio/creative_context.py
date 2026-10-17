"""Resolve selected observations inside the app's workspace; never accept client evidence."""

from rest_framework.exceptions import ValidationError

from .models import ResearchRun


def selected_sources(app, research_id, page_ids):
    if not research_id or not page_ids or len(page_ids) > 3 or len(set(page_ids)) != len(page_ids):
        raise ValidationError("Choose one to three observations from a completed research session.")
    research = ResearchRun.objects.filter(
        pk=research_id, app=app, workspace=app.workspace, workflow__status="succeeded"
    ).first()
    if not research or not research.report:
        raise ValidationError("Choose completed research for this app.")
    findings = {f["page_id"]: f for f in research.report["findings"]}
    pages = {
        str(p.pk): p
        for p in (research.evidence_root or research)
        .pages.filter(pk__in=page_ids, status="observed")
        .defer("top_image", "scroll_image")
    }
    if not set(page_ids) <= findings.keys() or set(page_ids) != pages.keys():
        raise ValidationError("Only retained observations with saved evidence can enter a brief.")
    return research, [
        {
            "page_id": page_id,
            "url": pages[page_id].final_url or pages[page_id].source["url"],
            "title": pages[page_id].title or pages[page_id].source["title"],
            "captured_at": pages[page_id].captured_at.isoformat(),
            "kind": pages[page_id].source["kind"],
            "finding": findings[page_id],
        }
        for page_id in page_ids
    ]
