from django.urls import path

from . import views

urlpatterns = [path("apps/", views.app_list), path("apps/<uuid:app_id>/", views.app_detail)]
