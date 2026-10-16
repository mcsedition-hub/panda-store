# Développement

Le démarrage documenté utilise venv/pip et npm. `requirements.txt` contient les
versions des dépendances serveur validées dans l'environnement Python 3.12 ;
`requirements-dev.txt` ajoute les outils. `web/package-lock.json` fixe le graphe
frontend. Les plages de `pyproject.toml` décrivent la compatibilité du paquet.

Pour réviser les dépendances, utiliser un environnement propre, mettre à jour
les plages si nécessaire, puis régénérer et tester les fichiers de versions :

```sh
pip-compile --strip-extras --no-emit-index-url --no-emit-trusted-host --output-file requirements.txt pyproject.toml
pip-compile --extra dev --strip-extras --no-emit-index-url --no-emit-trusted-host --constraint requirements.txt --output-file requirements-dev.txt pyproject.toml
```

Ne pas inclure d'index privé, de jeton, de chemin utilisateur ou de dépendance
editable locale dans ces fichiers. Tester ensuite l'installation depuis zéro,
le backend et le frontend avant de proposer la mise à jour.

## Variables principales

| Variable | Usage |
| --- | --- |
| DJANGO_SECRET_KEY | Secret de signature généré localement |
| DJANGO_DEBUG | Débogage local uniquement |
| DJANGO_ALLOWED_HOSTS | Hôtes acceptés, séparés par des virgules |
| DJANGO_CSRF_TRUSTED_ORIGINS | Origines autorisées pour le développement |
| DATABASE_URL | SQLite local ou PostgreSQL |
| PANDA_DEMO_MODE | Autorise les données fictives et modèles locaux |
| PANDA_DEMO_USERNAME / PASSWORD | Compte créé par seed_demo, sans reset ultérieur |
| PANDA_MODULE_PACKAGES | Liste complète des apps de modules installées |
| CELERY_TASK_ALWAYS_EAGER | Exécution synchrone pour le développement |
| CELERY_BROKER_URL | Redis pour les tâches asynchrones |
| DJANGO_SECURE_COOKIES | Cookies HTTPS par défaut hors DEBUG |
| POSTGRES_PASSWORD | Mot de passe du PostgreSQL local Compose |

`scripts/bootstrap.py` ne remplace jamais un `.env` existant. Lors de l'ajout
d'une variable, compléter le fichier local explicitement à partir de l'exemple.
`seed_demo` ne réinitialise ni le mot de passe d'un utilisateur existant ni ses apps.
Pour changer un mot de passe : `python manage.py changepassword demo`.

## Vérifications

Les tests couvrent le parcours principal, le jeton CSRF, les rôles, l'isolation
des objets entre espaces, les dépendances des modules, les imports répétés,
les générations répétées et leurs erreurs. Le frontend teste l'ordre des
sauvegardes, les retouches, l'approbation et les erreurs réseau.

Les tests locaux utilisent SQLite. Pour tester avec PostgreSQL, fournir une
base jetable via `TEST_DATABASE_URL` puis lancer pytest. Le compte doit pouvoir
créer une base de test. Ne jamais utiliser une base de production.

La CI contient un service PostgreSQL. Compose et le parcours dans un navigateur
doivent également être vérifiés avant une release : connexion, import, génération
par worker, modification, validation et export, aux largeurs mobile et desktop.
Un build réussi ne prouve pas à lui seul le bon rendu visuel.
