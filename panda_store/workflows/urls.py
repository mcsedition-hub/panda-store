from django.urls import path

from . import views

urlpatterns = [
    path("<uuid:run_id>/", views.detail),
    path("<uuid:run_id>/events/", views.events),
    path("<uuid:run_id>/cancel/", views.stop),
]
