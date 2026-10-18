# Module d'exemple

Ce module sert de référence aux développeurs. Il reste dans le dépôt, mais il est
masqué dans la navigation et dans l'écran Modules. Pour créer une extension visible,
copiez-le sous un nouvel identifiant en suivant le [guide des modules](../../docs/modules.md).

L'exemple comprend une page React et la route Django
`GET /api/workspaces/<uuid>/example/hello/`, protégée par l'appartenance à l'espace
et l'activation du module.

Il déclare sa dépendance à `app_catalog` dans `module.json` et n'ajoute pas de
table. Il utilise exactement le même registre et les mêmes contrôles d'accès que
les modules métier.
