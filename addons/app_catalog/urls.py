from django.urls import path

from . import projects, views

urlpatterns = [
    path("apps/", views.app_list),
    path("apps/<uuid:app_id>/", views.app_detail),
    path("projects/", projects.create),
    path("projects/<uuid:app_id>/", projects.update),
]
