from django.urls import include, path

from . import views

urlpatterns = [
    path("google-play/", include("addons.apple_store.google_play.urls")),
    path("catalog/", views.catalog),
    path("import/", views.import_demo),
    path("connections/", views.connections),
    path("connections/<uuid:connection_id>/", views.connection_detail),
    path("connections/<uuid:connection_id>/apps/", views.connection_apps),
    path("connections/<uuid:connection_id>/import/", views.import_live),
    path("apps/<uuid:app_id>/sync/", views.sync_app),
]
