# Architecture de l'alpha

Un monolithe Django modulaire expose une API REST consommée par React et
TypeScript. Les modules partagent une base et des conventions explicites.
Leur séparation ne nécessite pas des microservices au démarrage.

## Cœur et modules

Le cœur gère les comptes, les espaces, les appartenances et le registre.
Chaque module comprend une app Django, un `module.json`, des routes, ses modèles
et éventuellement `frontend/index.tsx`. Le chargement est effectué au déploiement.
L'activation dans un espace ouvre les fonctionnalités déjà installées.

Les dépendances, versions et cycles sont vérifiés au démarrage. Une activation
inclut ses dépendances ; la désactivation d'un module requis est refusée.
L'activation n'exécute pas d'installation Python ou de migration dynamique.
Il n'y a pas de format XML de vues : les vues métier sont des composants React.

## Données et droits

`User → Membership → Workspace → MobileApp → MetadataSnapshot`

`MobileApp → Brief → GenerationRun → Creative`

Un utilisateur peut appartenir à plusieurs espaces. Les rôles sont owner,
editor et viewer. Seul owner gère les modules ; viewer ne modifie pas de données.
Toutes les routes métier contrôlent l'appartenance, le rôle et le module actif.
Les UUID ne constituent pas un mécanisme d'autorisation. L'administration Django
est réservée aux administrateurs de l'installation, avec visibilité globale.
L'alpha ne possède pas encore d'interface d'invitation ou de création d'espaces ;
leur administration passe par Django admin ou les commandes Django.

L'isolation s'effectue au niveau applicatif, pas par une base distincte par
client ni par des politiques PostgreSQL RLS. Un module Python installé est du
code de confiance ayant accès au processus et à la base. Le registre n'est pas
une sandbox pour du code tiers malveillant.

## Import et génération

Le connecteur démo fournit des données locales explicitement fictives. Un import
met à jour l'app et crée un instantané si la dernière version diffère. Réimporter
le même contenu à la suite ne le duplique pas ; revenir à une ancienne version
crée un nouvel instantané chronologique.

Une génération enregistre le brief et les métadonnées utilisés avant de lancer
la tâche. Le couple espace/request_id protège contre les requêtes répétées ;
une réutilisation avec des entrées différentes donne HTTP 409. La tâche verrouille
son état et ne recrée pas les variantes après une seconde livraison normale.
Les états sont queued, running, succeeded et failed. Les erreurs sont enregistrées.

En local, Celery exécute immédiatement la tâche ; Compose utilise Redis et un
worker. La récupération après interruption brutale d'un worker n'est pas encore
implémentée : une tâche peut rester running. Ce point doit être traité avant
d'ajouter des appels IA longs ou des tâches de publication.

Les trois scripts proviennent de modèles de rédaction déterministes.
Ils sont éditables et exportables. Une modification invalide leur approbation,
même si un client envoie une approbation dans la même requête. Il n'existe encore
ni fournisseur IA, ni agent navigateur, ni publication automatique.

## Évolutions prévues

Les futurs agents devront conserver les sources et dates de leurs observations,
les actions effectuées et les coûts. Les connecteurs de stores et réseaux
sociaux auront des interfaces séparées. La veille et la génération peuvent
s'exécuter en tâches ; une publication nécessitera un contenu validé, une
destination explicite et un mécanisme de reprise idempotent.

La gestion des secrets externes, quotas, budgets IA, stockage des médias,
facturation et opérations cloud ne fait pas partie de cette alpha.
