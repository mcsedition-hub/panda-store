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

**Alpha 0.1.0 — développement local.** Connecter un compte Apple pour importer
des fiches iOS, ou utiliser les apps fictives : import → brief → trois scripts
issus de modèles → retouche → validation → export. Google Play, la génération IA
et la publication ne sont pas encore implémentés.

## Ce qui fonctionne

- Configuration initiale de l'organisation et du propriétaire, puis accès à la console.
- Sessions persistantes, espaces de travail et rôles propriétaire/éditeur/lecteur.
- Registre de modules avec dépendances, compatibilité et activation par espace.
- Catalogue de deux apps fictives, import persistant et historique des métadonnées.
- Connexions App Store Connect par espace, textes localisés, icônes, captures dans
  la langue principale et actualisation manuelle des métadonnées.
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
npm --prefix web ci
```

Dans deux terminaux :

```sh
.venv/bin/python manage.py runserver 127.0.0.1:8000
```

```sh
npm --prefix web run dev
```

Ouvrir **http://127.0.0.1:5173**. Au premier lancement, nommer l'organisation puis
choisir un identifiant, un e-mail et un mot de passe. L'organisation et le compte
sont enregistrés dans la base de cette installation ; le mot de passe est haché.
La console s'ouvre immédiatement. Elle s'ouvre aussi directement lors des visites
suivantes tant que la session est valide. Après déconnexion ou expiration, utiliser
les identifiants choisis. Aucun compte cloud ni envoi d'e-mail n'intervient.

La configuration locale active `PANDA_SETUP_ENABLED=true`. La configuration initiale
ne peut être validée qu'une fois. Pour mettre à jour une ancienne alpha, ajouter cette
variable à `.env` puis appliquer les migrations : l'unique espace de démo peut être
repris et renommé sans perdre ses apps. Les installations avec d'autres comptes
conservent leur connexion habituelle. Le script préserve les `.env` existants ;
ce fichier contient des secrets et ne doit jamais être publié.

Choisir **Connections → Try with demo apps**, importer **Runclub**, puis ouvrir le **Studio** pour
préparer trois pistes. L'espace initial est vide pour tester le vrai parcours
d'import. En mode local, SQLite et l'exécution synchrone des tâches suffisent :
aucun compte externe ni clé IA n'est nécessaire.

Pour un compte réel, choisir **Connections → Connect Apple** puis saisir le nom,
le type et l'identifiant de la clé, son fichier `.p8` et l'Issuer ID pour une clé
d'équipe. Ces identifiants sont enregistrés chiffrés par espace, jamais dans le
`.env`. Le propriétaire gère les clés ; les éditeurs peuvent importer et actualiser.
Le connecteur ne fait que des lectures. Il privilégie la version iOS publiée, sinon
la version brouillon la plus récente. Les appels Apple sont testés avec des réponses
simulées ; une validation sur compte réel reste nécessaire avant release.

Sur une ancienne installation, sauvegarder la base et le `.env`, puis lancer
`python scripts/bootstrap.py --add-credential-key`, appliquer les migrations et
redémarrer le backend. Les nouvelles installations génèrent cette clé automatiquement.
Conserver la clé de chiffrement pour pouvoir relire les identifiants enregistrés.
Voir le [parcours Apple détaillé](README.md#connect-an-apple-account) pour les limites
et la déconnexion.

## Démo avec Docker Compose

Avec Docker Engine et Compose démarrés :

```sh
python3 scripts/bootstrap.py
docker compose up --build
```

Ouvrir **http://127.0.0.1:8080** et suivre la même configuration initiale.
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
