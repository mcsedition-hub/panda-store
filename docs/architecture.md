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

Le manifeste distingue `availability: available` (valeur par défaut) de `planned`.
Un module prévu apparaît au catalogue mais ne peut être activé, même par appel API
ou comme dépendance. ASO est actuellement dans cet état ; aucun audit ou agent ASO
ne s'exécute encore. Les états Enabled/Disabled décrivent l'activation par espace.

La désactivation retire les accès métier sans supprimer les données importées.
Ainsi, désactiver Connections conserve les fiches dans My apps mais bloque leurs
imports et actualisations. L'interface relit les activations au retour sur un
onglet. Le worker Studio vérifie aussi l'activation sous le verrou de l'espace
avant de démarrer une génération en attente : si Studio est désactivé, elle échoue
sans appeler le fournisseur. Une tâche déjà commencée peut finir ; la désactivation
ne constitue pas une annulation d'un appel externe en cours.

## Données et droits

`User → Membership → Workspace → MobileApp → MetadataSnapshot`

`MobileApp → Brief → GenerationRun → Creative`

Un utilisateur peut appartenir à plusieurs espaces. Les rôles sont owner,
editor et viewer. Seul owner gère les modules et connexions ; viewer ne modifie pas de données.
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

Le module Apple conserve `Workspace → AppleConnection → AppleAppBinding → MobileApp`.
Chaque connexion possède une clé API chiffrée par l'installation et une révision.
L'appel réseau précède la transaction d'import ; les verrous et la révision empêchent
un import de recréer une connexion supprimée ou d'enregistrer des résultats avec
une clé remplacée. Déconnecter conserve les apps et instantanés mais retire leurs
liens de synchronisation. Les requêtes sont exclusivement GET vers l'API Apple.
Le client vérifie les pages suivantes et limite les délais, tailles et requêtes.
Le connecteur reste synchrone ; les gros imports et tâches planifiées viendront ensuite.

Une génération enregistre le brief et les métadonnées utilisés avant de lancer
la tâche. Le couple espace/request_id protège contre les requêtes répétées ;
une réutilisation avec des entrées différentes donne HTTP 409. La tâche verrouille
son état et ne recrée pas les variantes après une seconde livraison normale.
Les états incluent queued, running, canceling, succeeded, canceled et failed.
Les erreurs sont enregistrées ; le workflow lié fournit l’état de référence.

En local, `run_workflows` traite les tâches depuis la base ; Compose utilise
Redis et Celery. Les exécutions possèdent un bail et un heartbeat. Un worker
interrompu perd le droit d’enregistrer un résultat après expiration de son bail.
Le suivi et le worker local détectent les baux expirés ; la reprise est explicite.

Les trois scripts proviennent de modèles de rédaction déterministes.
Ils sont éditables et exportables. Une modification invalide leur approbation,
même si un client envoie une approbation dans la même requête. Il n'existe encore
ni fournisseur IA, ni agent navigateur, ni publication automatique.

## Évolutions prévues

L'audit ASO précède la création de scripts. Ses règles vérifiables par code restent
distinctes des appréciations éditoriales assistées par IA ; chacune conserve sa
source officielle et sa date. Les scripts référencent l'instantané audité de la
fiche, afin que les corrections et les générations restent traçables.

Les adaptateurs IA devront proposer OpenAI, Anthropic (Claude) et Google (Gemini)
derrière un contrat commun, tout en déclarant leurs capacités propres. L'espace
configure ses clés et son modèle par défaut ; l'utilisateur peut choisir un autre
fournisseur et modèle pour une tâche. Le catalogue reste configurable et actualisable,
avec filtrage des modèles incompatibles. Chaque exécution enregistre le fournisseur,
le modèle exact, la consommation et les erreurs. Aucun basculement implicite vers
un autre fournisseur n'est autorisé. Ces adaptateurs ne sont pas encore implémentés.

Les futurs agents devront conserver les sources et dates de leurs observations,
les actions effectuées et les coûts. Les connecteurs de stores et réseaux
sociaux auront des interfaces séparées. La veille et la génération peuvent
s'exécuter en tâches ; une publication nécessitera un contenu validé, une
destination explicite et un mécanisme de reprise idempotent.

Les quotas, budgets IA, stockage durable des médias,
facturation et opérations cloud ne font pas partie de cette alpha.

## Workflows et événements d'exécution

Le socle `panda_store.workflows` est partagé, avec une première intégration dans
Studio. `WorkflowRun`, `StepRun` et `RunEvent` conservent la définition versionnée,
les dépendances, les états, les dates et les événements ordonnés. Studio fige
l'instantané, le brief et le fournisseur dans `GenerationRun`. Les anciennes
générations restent lisibles sans inventer d'événements historiques.

Le parcours actuel est séquentiel : lire les métadonnées et le brief, produire
les trois modèles de scripts, puis les enregistrer pour revue. Un contrat de
module déclare ses étapes et un adaptateur `workflow.RUNNERS` associe une clé et
une version à son exécuteur. Les dépendances sont vérifiées à la création ; le
worker local charge seulement les adaptateurs des packages déjà installés dans
le registre. Le code des modules conserve le modèle de confiance existant.

Les transitions et événements sont enregistrés dans une même transaction sous
verrou de l'exécution. Un jeton de bail protège les écritures contre un worker
ancien ou annulé. Le heartbeat prolonge un bail de 45 secondes toutes les dix
secondes. Une tâche en attente depuis plus de cinq minutes est marquée en échec
lors de sa consultation, avec une indication pour démarrer le worker. Les clients
actifs et le worker local détectent les baux expirés ; il n'existe pas encore de
superviseur périodique autonome pour les exécutions Celery non consultées.

Les routes communes `/api/workspaces/{id}/workflows/{run}/` et `events/` fournissent
respectivement un état paginé et un flux SSE authentifié. Elles vérifient espace,
appartenance et activation du module. Le flux réévalue les accès à chaque lot,
accepte `Last-Event-ID` et conserve des événements ordonnés en base. Il dure au plus
25 secondes ; EventSource se reconnecte, avec polling de secours côté React.
Uvicorn/ASGI et Nginx sans buffering sont configurés pour Compose. Le backend
utilise `CONN_MAX_AGE=0` et les threads de heartbeat ferment leurs connexions à
la sortie. Ce réglage suit les [recommandations Django pour ASGI](https://docs.djangoproject.com/en/5.2/topics/async/#queries-the-orm).
Le serveur
WSGI de développement reste compatible avec un flux synchrone borné. Une coupure
du flux est signalée séparément de l'échec de la tâche.

`Stop` annule immédiatement une tâche en file ou demande un arrêt coopératif
(`canceling`) si elle travaille. La fin de l'appel courant est attendue ; son
résultat est écarté si le bail ou le statut ne l'autorise plus. La sauvegarde des
scripts et la réussite du workflow sont atomiques. Un arrêt ne défait pas une
publication externe et le Studio actuel n'en effectue aucune.

`Retry unfinished steps` crée une tentative liée, conserve la précédente et
réutilise les checkpoints terminés lorsque version, étapes et dépendances
correspondent. Studio reprend les entrées originales, même si la fiche ou le
brief ont changé depuis. Une seule reprise par tentative rend les doubles clics
idempotents. Les checkpoints internes ne sont pas exposés dans l'API d'activité ;
les messages sont des résumés contrôlés, jamais des réponses brutes du fournisseur.
Les scripts produits restent soumis à leur approbation séparée existante.

Le panneau React commun présente les étapes cliquables, leur durée réelle, un
journal horodaté et les commandes permises par le rôle. Il reprend les événements
sans doublons et retire les données si l'accès est révoqué. Il n'allonge pas
artificiellement une génération courte pour simuler une activité d'agent.

Les tests couvrent arrêt en file et pendant un outil, résultats tardifs, reprise
sans nouvelle génération des résultats sauvegardés, curseurs et reconnexion,
accès révoqués, panne de dispatch, worker expiré et flux ASGI. Les doubles
livraisons concurrentes sont aussi vérifiées sur PostgreSQL en CI.

Restent à construire : agents IA et navigateur, ordonnanceur de branches
parallèles, validation humaine suspendant un workflow, contrats de progression
quantifiée et de médias privés, éditeur visuel et supervision autonome de toutes
les tâches. Chaque connecteur avec effets externes devra ajouter idempotence et
réconciliation. Les URLs, captures et coûts seront exposés seulement lorsque
les outils concernés les auront réellement produits.

## Conception de l'agent ASO spécialisé

Cette section décrit le contrat à implémenter. Le module est prévu au catalogue,
et [le catalogue de sources](../addons/aso/knowledge/sources.json) est une première
sélection relue, avec usages et limites. Ce n'est pas encore un corpus indexé,
un agent entraîné ou un moteur de recommandations opérationnel.

### Connaissances et preuves

La spécialisation doit couvrir découverte, intentions de recherche, mots-clés,
conversion, visuels, localisation, avis, expérimentation et mesure. Elle repose sur
des outils métier, des sources consultables et des évaluations. Une connaissance
du modèle seul ne suffit pas à justifier une règle, statistique ou promesse produit.

Les sources sont sélectionnées au niveau de l'article et de l'affirmation :

- Apple et Google : exigences et recommandations classées séparément, avec leur portée.
- Phiture / ASO Stack : cadre de travail et méthodes de praticiens.
- AppTweak : recherche de mots-clés et distinction entre observations, données de
  comptes connectés et estimations propriétaires.
- SplitMetrics : conception d'expériences et cas clients contextualisés. Un test
  sur une page simulée avec trafic publicitaire n'est pas une mesure native
  d'installations organiques.
- Fiches de grandes apps et concurrents comparables : observations datées, sans
  prétendre connaître leurs taux de conversion ou mots-clés privés.
- Données et expériences de l'app : résultats isolés par workspace et liés à un instantané.

La réputation d'une société n'approuve pas toutes ses affirmations. Conserver
éditeur, auteur disponible, URL, dates, store, pays, langue, contexte, type de preuve
et limites. Les résultats commerciaux restent attribués à leur auteur. Les chiffres
sans méthode et contradictions restent à vérifier. Une référence ancienne peut
illustrer une méthode sans décrire les stores actuels. Un article inaccessible
n'est jamais résumé comme s'il avait été lu.

Le catalogue distribué contient liens et annotations originales. L'indexation
future respecte les autorisations d'accès et de réutilisation ; aucune copie
intégrale de blogs tiers n'est redistribuée. Les règles évoluent avec historique.

### Graphe de connaissances et recherche documentaire

Le graphe proposé relie chaque proposition à ses preuves :

```mermaid
flowchart LR
    S[Version de source] -->|appuie ou contredit| R[Affirmation ou règle]
    R -->|concerne| C[Store, champ, langue et période]
    O[Observation de la fiche] -->|motive| P[Proposition]
    R -->|justifie| P
    P -->|évaluée par| E[Expérience]
    E -->|produit| M[Résultat et incertitude]
```

Des tables Django compatibles SQLite et PostgreSQL suffisent pour commencer ;
aucun service de graphe supplémentaire n'est obligatoire pour l'auto-hébergement.
Chaque relation conserve origine, portée et statut de vérification. Une proximité
sémantique n'est pas une relation causale. Les liens proposés par l'IA doivent être
vérifiés avant leur utilisation comme preuve.

La recherche filtre d'abord par store, langue, marché, période et fonctionnalité,
puis retrouve les documents et suit les liens vers les sources, contradictions et
expériences applicables. Recherche textuelle puis sémantique facultative : les
embeddings ne remplacent pas les filtres et preuves. Les concepts sont réutilisables ;
les résultats privés restent limités au workspace. Les apports communautaires passent
par revue des sources et tests et ne deviennent pas des instructions exécutables.

### Exécution et validation

Vérifier d'abord la couverture : version, langues, captures par langue et appareil,
marché cible, fonctions confirmées et statistiques disponibles. L'import actuel
ne couvre que les captures de la langue principale ; une autre langue non importée
ne prouve donc pas un défaut de la fiche.

Le parcours prévu : collecte, contrôles déterministes, recherche documentaire et
concurrentielle, propositions contextualisées, validation, protocole de mesure.
Les contrôles déterministes fonctionnent sans clé IA ; l'analyse éditoriale utilise
le fournisseur et modèle choisis. Les pages et documents sont des données non
fiables, jamais des instructions pour l'agent.

Une proposition conserve l'instantané, le champ, le constat, les références exactes,
le remplacement, les conditions d'application, le statut (correction vérifiable,
hypothèse à tester ou données insuffisantes) et la méthode de validation. Le validateur
rejette références inexistantes, contraintes dépassées, fonctions inventées et
statistiques sans source. Il distingue pertinence d'un terme, demande mesurée et
estimation tierce. Les connecteurs de données payants restent facultatifs.

Avant activation, évaluer sur des cas relus par un humain : fiches correctes sans
correction forcée, données incomplètes, stores différents, langues non couvertes,
sources obsolètes ou contradictoires, absence de statistiques, promesses non
confirmées et contenus tentant de détourner l'agent. Vérifier citations, portée
des règles, utilité des propositions et abstention pour chaque fournisseur.
Les évaluations du modèle ne remplacent pas la mesure des gains sur le store.
