from addons.app_catalog.services import import_app
from addons.apple_store.connector import DemoAppleConnector


def test_return_to_previous_metadata_keeps_the_latest_state(workspace):
    original = DemoAppleConnector().get_metadata("demo.runclub")
    app, _ = import_app(workspace, metadata=original, source="demo", is_demo=True)
    changed = {**original, "subtitle": "A new subtitle"}
    import_app(workspace, metadata=changed, source="demo", is_demo=True)
    import_app(workspace, metadata=original, source="demo", is_demo=True)
    assert app.snapshots.count() == 3
    assert app.snapshots.first().data == original
    import_app(workspace, metadata=original, source="demo", is_demo=True)
    assert app.snapshots.count() == 3
