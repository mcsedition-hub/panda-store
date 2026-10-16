from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import Membership, ModuleActivation, User, Workspace

admin.site.register(User, UserAdmin)
admin.site.register([Workspace, Membership, ModuleActivation])
