from django.urls import path

from . import drafts, views

urlpatterns = [
    path("knowledge/", views.knowledge),
    path("apps/<uuid:app_id>/runs/", views.runs),
    path("runs/<uuid:run_id>/retry/", views.retry),
    path("images/<uuid:image_id>/", views.image),
    path("apps/<uuid:app_id>/drafts/", drafts.drafts),
    path("drafts/<uuid:draft_id>/", drafts.detail),
    path("drafts/<uuid:draft_id>/history/", drafts.history),
    path("drafts/<uuid:draft_id>/export/", drafts.export),
]
