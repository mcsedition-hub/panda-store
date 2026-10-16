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
| PANDA_CREDENTIAL_KEYS | Clés Fernet de cette installation, séparées par des virgules ; première utilisée pour chiffrer les identifiants Apple saisis dans l'interface |
| DJANGO_DEBUG | Débogage local uniquement |
| DJANGO_ALLOWED_HOSTS | Hôtes acceptés, séparés par des virgules |
| DJANGO_CSRF_TRUSTED_ORIGINS | Origines autorisées pour le développement |
| DATABASE_URL | SQLite local ou PostgreSQL |
| PANDA_DEMO_MODE | Autorise les données fictives et modèles locaux |
| PANDA_SETUP_ENABLED | Active l'assistant initial d'une installation vide ou de l'unique espace de démo historique |
| PANDA_DEMO_USERNAME / PASSWORD | Compte de l'ancien outil seed_demo ; les nouveaux comptes sont créés par l'assistant |
| PANDA_MODULE_PACKAGES | Liste complète des apps de modules installées |
| CELERY_TASK_ALWAYS_EAGER | Exécution synchrone pour le développement |
| CELERY_BROKER_URL | Redis pour les tâches asynchrones |
| DJANGO_SECURE_COOKIES | Cookies HTTPS par défaut hors DEBUG |
| POSTGRES_PASSWORD | Mot de passe du PostgreSQL local Compose |

`scripts/bootstrap.py` ne remplace jamais un `.env` existant. L'option explicite
`--add-credential-key` ajoute uniquement la clé de chiffrement si son entrée est
absente, pour mettre à jour les anciennes installations. Redémarrer ensuite les
processus Django et Celery. Les identifiants Apple restent propres à chaque espace
et sont saisis dans Connections, jamais dans les variables d'environnement.
`seed_demo` est conservé pour les anciennes démos et refuse une installation déjà
configurée. Le démarrage normal ne l'exécute plus. L'assistant crée le propriétaire,
l'espace et ses modules dans une transaction unique, puis ouvre une session Django.
L'enregistrement Installation empêche une seconde configuration, même si deux
onglets tentent de la terminer simultanément. L'ancienne option `PANDA_LOCAL_ACCESS`
n'est plus utilisée : aucune session sans mot de passe n'est créée au démarrage.
Pour changer un mot de passe : `python manage.py changepassword <username>`.

SQLite conserve les comptes, organisations, sessions et données métier dans
`panda.sqlite3` en local. Compose conserve ces mêmes tables dans le volume PostgreSQL.
Le navigateur ne conserve pas le mot de passe ; le cookie de session identifie
une session enregistrée côté serveur. L'e-mail est enregistré mais pas vérifié
par un envoi ; la récupération de mot de passe par e-mail n'est pas encore implémentée.

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
