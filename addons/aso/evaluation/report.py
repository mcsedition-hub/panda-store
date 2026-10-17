"""Portable, escaped HTML for manual review. No script or external resource loading."""

import html
import json

from .suite import RUBRIC


def render(document):
    def esc(value):
        return html.escape(str(value))

    def pre(value):
        return "<pre>" + esc(value) + "</pre>"

    sections = []
    for row in document["rows"]:
        case = row["case"]
        heading = esc(case["title"]) + " · attempt " + esc(row["attempt"])
        if row["status"] != "evaluated":
            content = "<p>" + esc(row["error"]) + "</p>"
            label = row["status"].replace("_", " ")
        else:
            assessment = row["assessment"]
            label = "Expectations met" if assessment["passed"] else "Review failures"
            content = (
                "<ul>"
                + "".join(
                    f"<li><strong>{'PASS' if item['passed'] else 'FAIL'} · "
                    f"{esc(item['id'])}</strong>"
                    f" — {esc(item['detail'])}</li>"
                    for item in assessment["checks"]
                )
                + "</ul>"
            )
            report = assessment["report"]
            if report:
                for item in report["editorial"]["assessments"]:
                    content += (
                        f"<h3>{esc(item['field'])} · {esc(item['verdict'])}</h3>"
                        f"<p>{esc(item['observation'])}</p>"
                    )
                for item in report["checks"]:
                    if item["basis"] == "editorial_hypothesis":
                        content += (
                            f"<h3>Proposed {esc(item['field'])}</h3>"
                            f"<p>{esc(item['observation'])}</p>" + pre(item["replacement"])
                        )
            content += (
                "<details><summary>Raw response and usage</summary>"
                + pre(json.dumps(row["output"], ensure_ascii=False, indent=2))
                + "</details>"
            )
        if row.get("grounding_output"):
            content += (
                "<details><summary>Evidence review and usage</summary>"
                + pre(json.dumps(row["grounding_output"], ensure_ascii=False, indent=2))
                + "</details>"
            )
        context = row["context"]
        original = "".join(
            f"<h3>{esc(field)}</h3>" + pre(value) for field, value in context["listing"].items()
        )
        notes = "".join(f"<li>{esc(note)}</li>" for note in case["review_notes"])
        sections.append(
            f"<section><h2>{heading}</h2><p class='tag'>{esc(label)} · Human review pending</p>"
            f"<p>{esc(case['purpose'])}</p><details><summary>Imported copy</summary>{original}"
            f"</details>{content}<h3>Review guidance</h3><ul>{notes}</ul></section>"
        )
    rubric = "".join(f"<li><strong>{esc(k)}</strong>: {esc(v)}</li>" for k, v in RUBRIC.items())
    summary = document["summary"]
    regrades = "".join(
        "<p><strong>Regraded saved responses (no new model calls):</strong> "
        + esc(item["reason"])
        + "</p>"
        for item in document.get("regrades", [])
    )
    return (
        "<!doctype html><html lang='en'><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1'>"
        "<meta http-equiv='Content-Security-Policy' "
        "content=\"default-src 'none'; style-src 'unsafe-inline'\">"
        "<title>Panda Store · ASO evaluation</title><style>"
        "body{max-width:1000px;margin:40px auto;padding:0 24px;background:#f5f1e9;color:#252822;"
        "font:16px/1.6 system-ui,sans-serif}h1,h2,h3{line-height:1.25}"
        "section{border-top:1px solid #bcbfb5;padding:24px 0}pre{white-space:pre-wrap;"
        "overflow-wrap:anywhere;background:#fffdf8;padding:16px;border:1px solid #ddd}"
        "summary{cursor:pointer;font-weight:600}.tag{font-weight:600}li{margin:8px 0}"
        "@media print{details{display:block}body{background:white}}"
        "</style><h1>ASO evaluation</h1><p>"
        f"{summary['expectations_met']} of {summary['evaluated']} evaluated attempts meet the "
        f"automated expectations. {summary['errors']} errors; {summary['not_run']} not run; "
        f"{summary.get('unfinished', 0)} unfinished.</p>"
        "<p><strong>Human review pending.</strong> These are provisional checks on synthetic "
        "listings, not an ASO score, expert certification or evidence of download impact. "
        "A matching word or a valid quote does not prove a useful recommendation.</p>"
        f"<p>{esc(document['provenance'])}</p>"
        f"<p>{esc(document['provider'])} / {esc(document['model'])} · "
        f"{esc(document['created_at'])}</p>"
        + regrades
        + "<details><summary>Versions and reproducibility</summary>"
        + pre(json.dumps(document["manifest"], indent=2))
        + "</details>"
        "<h2>Editorial review rubric</h2><p>For each attempt, record pass, fail or not applicable "
        "for each criterion, with an example from the output. Identify the reviewer and date. "
        "Independent human review is required before making quality claims.</p><ul>"
        + rubric
        + "</ul>"
        + "".join(sections)
        + "</html>"
    )
