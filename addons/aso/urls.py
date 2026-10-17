from django.urls import path

from . import drafts, screenshot_briefs, views

urlpatterns = [
    path("knowledge/", views.knowledge),
    path("apps/<uuid:app_id>/runs/", views.runs),
    path("runs/<uuid:run_id>/retry/", views.retry),
    path("images/<uuid:image_id>/", views.image),
    path("apps/<uuid:app_id>/screenshot-briefs/", screenshot_briefs.briefs),
    path("screenshot-briefs/<uuid:brief_id>/", screenshot_briefs.detail),
    path("screenshot-briefs/<uuid:brief_id>/history/", screenshot_briefs.history),
    path("screenshot-briefs/<uuid:brief_id>/export/", screenshot_briefs.export),
    path("apps/<uuid:app_id>/drafts/", drafts.drafts),
    path("drafts/<uuid:draft_id>/", drafts.detail),
    path("drafts/<uuid:draft_id>/history/", drafts.history),
    path("drafts/<uuid:draft_id>/export/", drafts.export),
]
