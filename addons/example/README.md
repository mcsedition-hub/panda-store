# Module d'exemple

Ce module est installé par défaut et désactivé dans l'espace de démonstration.
L'activer depuis « Les modules » expose une page React et une route Django
`GET /api/workspaces/<uuid>/example/hello/` protégée par l'appartenance à l'espace.

Il déclare sa dépendance à `app_catalog` dans `module.json` et n'ajoute pas de
table. Il utilise exactement le même registre et les mêmes contrôles d'accès que
les modules métier. Voir [le guide](../../docs/modules.md) avant de le décliner.
