from django.urls import path

from . import views

urlpatterns = [
    path("apps/<uuid:app_id>/runs/", views.runs),
    path("runs/<uuid:run_id>/retry/", views.retry),
]
