from django.urls import path

from . import creative_views, research_views, views

urlpatterns = [
    path("apps/<uuid:app_id>/ai-runs/", creative_views.generate),
    path("research-capabilities/", research_views.capabilities),
    path("apps/<uuid:app_id>/research/", research_views.runs),
    path("research/<uuid:run_id>/", research_views.detail),
    path("research/<uuid:run_id>/retry/", research_views.retry),
    path("research-pages/<uuid:page_id>/<str:frame>/", research_views.image),
    path("apps/<uuid:app_id>/brief/", views.brief),
    path("apps/<uuid:app_id>/runs/", views.runs),
    path("creatives/<uuid:creative_id>/", views.edit_creative),
    path("runs/<uuid:run_id>/export/", views.export_run),
    path("runs/<uuid:run_id>/retry/", views.retry_run),
]
