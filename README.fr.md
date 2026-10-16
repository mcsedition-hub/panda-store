<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="web/public/brand/logo-dark.svg">
    <img src="web/public/brand/logo-light.svg" alt="Panda Store" width="380">
  </picture>
</p>

# Panda Store

[English README](README.md). L’anglais est la langue par défaut du produit.

L'atelier modulaire pour développer l'audience de vos applications mobiles.
Code source accessible et auto-hébergeable, sous [Elastic License 2.0](LICENSE).

**Alpha 0.1.0 — démonstration locale.** Cette première version permet de parcourir
le produit, de développer des modules et de vérifier une boucle complète :
import d'une app fictive → brief → trois scripts → retouche → validation → export.
Elle n'appelle ni Apple, ni Google, ni une IA et ne publie aucun contenu.

## Ce qui fonctionne

- Connexion par session, espaces de travail et rôles propriétaire/éditeur/lecteur.
- Registre de modules avec dépendances, compatibilité et activation par espace.
- Catalogue de deux apps fictives, import persistant et historique des métadonnées.
- Brief éditable, trois variantes produites par des modèles de rédaction locaux.
- Historique des générations, édition, validation séparée et export Markdown.
- Module d'exemple utilisant les mêmes conventions que les modules intégrés.

Les visuels Audit ASO, Veille, Publication, Mesure et Agents font partie de
l'identité graphique ; leurs fonctionnalités ne sont pas encore implémentées.
Voir la [feuille de route](docs/roadmap.md).

## Démarrer en local

Prérequis : Python 3.12 et Node.js 24. Depuis la racine du dépôt :

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python scripts/bootstrap.py
.venv/bin/python manage.py migrate
.venv/bin/python manage.py seed_demo
npm --prefix web ci
```

Dans deux terminaux :

```sh
.venv/bin/python manage.py runserver 127.0.0.1:8000
```

```sh
npm --prefix web run dev
```

Ouvrir **http://127.0.0.1:5173**. L'identifiant se trouve dans
`PANDA_DEMO_USERNAME` et le mot de passe dans `PANDA_DEMO_PASSWORD` du fichier
local `.env`. Le script crée des secrets aléatoires une seule fois ; ce fichier
n'est pas versionné. Il ne faut jamais le publier.

Choisir **Connections**, importer **Runclub**, puis ouvrir le **Studio** pour
préparer trois pistes. L'espace initial est vide pour tester le vrai parcours
d'import. En mode local, SQLite et l'exécution synchrone des tâches suffisent :
aucun compte externe ni clé IA n'est nécessaire.

## Démo avec Docker Compose

Avec Docker Engine et Compose démarrés :

```sh
python3 scripts/bootstrap.py
docker compose up --build
```

Ouvrir **http://127.0.0.1:8080** avec les mêmes identifiants de `.env`.
Cette variante utilise PostgreSQL, Redis, un worker Celery, Django et Nginx.
La base est distincte de la base SQLite locale. `docker compose down` conserve
les données dans les volumes. L'option `--volumes` les supprimerait.

Compose est limité à localhost et au mode démo. Ce n'est pas une configuration
de production. Voir [SECURITY.md](SECURITY.md) pour les limites actuelles.

## Développer et vérifier

```sh
.venv/bin/ruff check .
.venv/bin/ruff format --check .
.venv/bin/pytest
.venv/bin/python manage.py check
.venv/bin/python manage.py makemigrations --check --dry-run
npm --prefix web test
npm --prefix web run format:check
npm --prefix web run build
```

La CI est configurée pour exécuter les tests serveur avec PostgreSQL et les
tests d'interface avec jsdom. Les tests d'interface ne remplacent pas une revue
visuelle dans un navigateur.

```text
panda_store/       configuration Django, comptes, espaces, registre
addons/           modules Django + manifestes + interfaces React
web/              coque React/TypeScript, design et ressources locales
docs/             architecture, modules, licence et feuille de route
tests/            tests d'intégration et d'isolation des espaces
deploy/           proxy local de la démo Compose
```

- [Architecture](docs/architecture.md)
- [Créer un module](docs/modules.md)
- [Environnement de développement](docs/development.md)
- [Contributions](CONTRIBUTING.md)

## Licence et offre cloud

ELv2 permet notamment l'usage interne et l'auto-hébergement. Elle interdit de
fournir à des tiers un service hébergé ou géré donnant accès à un ensemble
substantiel des fonctionnalités du logiciel. Elle **n'interdit pas toute
activité commerciale**. Le texte de la licence prévaut.

Cette restriction protège le projet d'une reprise en service cloud concurrent.
Le cloud officiel est prévu, mais n'est pas lancé. Cette édition est
**source available**, pas open source au sens OSI. Les modalités des
contributions externes sont en préparation : [détails](docs/licensing.md).

L'organisation modulaire s'inspire d'Odoo ; Panda Store possède son propre code,
ses interfaces et ses visuels. Aucun code ni visuel Odoo n'est embarqué.
