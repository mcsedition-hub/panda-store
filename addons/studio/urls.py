from django.urls import path

from . import views

urlpatterns = [
    path("apps/<uuid:app_id>/brief/", views.brief),
    path("apps/<uuid:app_id>/runs/", views.runs),
    path("creatives/<uuid:creative_id>/", views.edit_creative),
    path("runs/<uuid:run_id>/export/", views.export_run),
]
