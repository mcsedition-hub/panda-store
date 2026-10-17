# Développer un module

Le contrat de modules est expérimental pendant la série 0.1. Le dossier
[`addons/example`](../addons/example) montre un module minimal complet.
Il est installé mais désactivé par défaut. Activez-le depuis « Les modules ».

## Structure

```text
addons/my_module/
  __init__.py
  apps.py
  module.json
  urls.py
  models.py                si le module possède des données
  migrations/              migrations Django versionnées
  frontend/index.tsx       export default d'un composant ModuleProps
  tests/                   droits, données et comportements du module
```

Un manifeste :

```json
{
  "id": "my_module",
  "name": "Mon module",
  "version": "0.1.0",
  "core": ">=0.1,<0.2",
  "depends": {"app_catalog": ">=0.1,<0.2"},
  "family": "lichen",
  "icon": "extensions",
  "description": "Ce que ce module permet de faire.",
  "capabilities": ["my_module.read"]
}
```

Les contraintes de versions utilisent la syntaxe de `packaging.SpecifierSet`.
Les familles sont frost, coral et lichen. `icon` désigne une ressource locale
`web/public/modules/<icon>.webp`. Les capabilities sont des déclarations
descriptives, pas des permissions appliquées automatiquement.

`availability` vaut `available` par défaut. La valeur `planned` présente un module
à venir au catalogue et interdit son activation, y compris comme dépendance.
Un module requis ne peut pas être prévu. ASO utilise ce statut pendant sa conception.

## Installation et activation

1. Ajouter le module sous `addons/` avec un id égal au nom du dossier. Cette
   convention relie le manifeste serveur au composant découvert par Vite.
2. Ajouter son chemin Python à `PANDA_MODULE_PACKAGES` dans `.env`, en conservant
   les modules nécessaires. Cette variable remplace la liste complète.
3. Créer ses migrations, lancer `manage.py migrate`, reconstruire l'interface,
   puis redémarrer le serveur et les workers.
4. Le propriétaire de chaque espace peut l'activer. Ses dépendances s'activent
   ensemble. Une désactivation conserve les données existantes.

Les paquets Python externes sans interface peuvent utiliser le même registre.
Les interfaces de paquets externes nécessitent pour l'instant un ajout au build
sous `addons/`. Il n'existe pas d'installation à chaud depuis une marketplace.

## Routes et accès

Les routes sont montées automatiquement sous
`/api/workspaces/<workspace_id>/<module_id>/`.

Chaque endpoint doit appeler `workspace_access(request.user, workspace_id,
module="my_module")`, avec `write=True` pour modifier des données. Il doit
ensuite filtrer **toutes** les recherches d'objets par cet espace. La présence
d'un bouton dans React ne vaut jamais autorisation serveur.

Ne pas stocker de secrets dans les manifestes, les réponses API ou les sources
frontend. Ne pas importer les modules d'un autre espace via leur UUID seul.
Les dépendances doivent déclarer les imports entre modules. Les mises à jour
doivent conserver les données ou fournir une migration explicite.

## Interface

Le composant reçoit `ModuleProps`, défini dans `web/src/contracts.ts` : espace,
apps disponibles, app sélectionnée et callbacks de sélection/navigation.
`web/src/api.ts` transmet la session et le jeton CSRF pour les appels à l'API.
Les modules sont chargés à la demande dans la coque React, puis contrôlés
indépendamment côté serveur.

Avant de distribuer ou proposer un module, lire [la politique de contributions](../CONTRIBUTING.md)
et [les modalités de licence](licensing.md). Un module tiers n'obtient pas
automatiquement une place dans l'offre cloud officielle.
