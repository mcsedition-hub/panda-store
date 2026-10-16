from django.urls import path
from rest_framework.decorators import api_view
from rest_framework.response import Response

from panda_store.core.access import workspace_access


@api_view(["GET"])
def hello(request, workspace_id):
    workspace = workspace_access(request.user, workspace_id, module="example")
    return Response({"message": f"Le module d’exemple est actif dans {workspace.name}."})


urlpatterns = [path("hello/", hello)]
