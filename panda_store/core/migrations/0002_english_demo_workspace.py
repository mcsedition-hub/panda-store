from django.db import migrations


def rename_seeded_workspace(apps, schema_editor):
    Workspace = apps.get_model("core", "Workspace")
    Workspace.objects.using(schema_editor.connection.alias).filter(
        pk="8883d058-1f9b-472c-86d9-b3777dc29c13", name="Mon atelier"
    ).update(name="My workshop")


class Migration(migrations.Migration):
    dependencies = [("core", "0001_initial")]
    operations = [migrations.RunPython(rename_seeded_workspace, migrations.RunPython.noop)]
