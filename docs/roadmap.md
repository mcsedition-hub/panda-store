# Feuille de route

Cette feuille de route distingue le périmètre retenu, les fonctions livrées et les
validations restantes. Elle ne promet pas de date de sortie.

## Périmètre de la première version publique

L'édition communautaire auto-hébergée se concentre sur **deux modules métier : ASO et SMM**.

- **ASO** : analyser une fiche store, préparer des corrections, les modifier et les exporter.
- **SMM** : chercher des contenus performants dans le navigateur de l'utilisateur,
  qualifier les références, puis produire, modifier et exporter une à trois adaptations
  distinctes en respectant leurs formats et les fonctionnalités confirmées de l'app.

Le catalogue d'apps, les connexions Apple, Google Play et IA, les espaces et les workflows constituent
le socle de ces parcours. Le module d'exemple sert aux développeurs. Aucun troisième
module métier n'est prévu pour cette première version ; les retours d'usage guideront
les ajouts ultérieurs.

**Réservé à la future version cloud :** connexion des comptes et pages sociaux pour
la publication, envoi et programmation des contenus. Ces fonctions restent à construire
et ne conditionnent pas la sortie communautaire. Le connecteur navigateur de recherche
reste dans SMM communautaire ; il utilise la session du navigateur pour consulter les
contenus, sans établir une connexion de publication.

## État actuel

| Étape | Résultat attendu | État |
| --- | --- | --- |
| Fondation | Espaces, modules, import fictif, brief, 3 scripts, export | Alpha implémentée |
| App réelle | App Store Connect, sélection d'apps, instantanés, erreurs de connexion | Import et actualisation validés sur un compte Apple réel avec une clé d'équipe |
| Audit ASO | Recommandations avec règle officielle, source, date et correction proposée | Contrôles Apple, revue IA des textes et captures, brouillons, briefs de captures et évaluations implémentés ; recherche propre à chaque audit à construire |
| Workflows | Étapes en direct, journal durable, arrêt et reprise | Socle partagé ASO/SMM et générations IA implémentés ; branches parallèles et éditeur à construire |
| Veille SMM | Contenus pertinents trouvés dans le navigateur avec preuves de performance | Tests réels : 11 publications TikTok et quatre références retenues, 12 Instagram et une retenue, six Facebook et une retenue ; découverte de liens via Google vérifiée |
| Création SMM | Trois adaptations de références distinctes, selon leur format et les faits produit | Références compatibles réutilisables entre recherches ; lot MonTri UGC TikTok / carrousel Instagram / texte Facebook sauvegardé, relu et corrigé ; brouillons non approuvés |
| Google Play | Import des fiches Android, puis extension de l'ASO | Connexion, import et actualisation implémentés et testés automatiquement ; validation sur un compte réel et audit ASO Android à compléter |
| Mesure | Liens de campagne, séries temporelles, rapports et limites d'attribution | Besoin à prioriser après les retours d'usage ; hors première version publique |
| Publication SMM — cloud | Comptes et pages sociaux connectés, publication et programmation, aperçu et statut d'envoi | Réservée au cloud, à construire |
| Exploitation cloud | Isolation renforcée, facturation, quotas, sauvegardes, support | À construire pour l'offre hébergée |

## Prochaine tranche

**Priorité : finaliser les parcours ASO et SMM pour une première utilisation autonome.**
Les collectes réelles et la génération multiformat ont été exercées. La préparation de
la sortie porte maintenant sur la fiabilité, l'installation, la clarté de l'interface
et les exports. Voir le [cadrage SMM](architecture.md#module-smm--marketing-organique).

La vérification du 17 octobre 2026 a utilisé une copie isolée du dépôt, un nouvel
environnement Python, `npm ci` et une base SQLite vierge, sans les clés ni les données
de l'installation de travail. Les points restants sont indiqués séparément.

- [x] **Installation native.** Installation des dépendances, bootstrap rejouable,
  migrations, démarrage de l'API, de l'interface et du worker. Création d'un compte
  depuis Chrome ; ASO et SMM sont activés dès la configuration initiale.
- [x] **Parcours ASO sans clé IA.** Import de Runclub, audit terminé par le worker,
  constats et limites visibles, modification d'un sous-titre, conservation après
  rechargement et export de la révision sauvegardée vérifiés.
- [x] **Édition SMM et exports.** Trois scripts de démonstration créés, modification
  sauvegardée et retrouvée après rechargement, export vérifié. L'export du lot réel
  MonTri UGC/carrousel/texte conserve les faits produit, les références, les compteurs
  manquants ou arrondis, les formats, les limites et les corrections de relecture.
  Les trois adaptations restent à approuver.
- [x] **Contrôles automatisés.** 367 tests serveur réussis sur PostgreSQL, dont les
  trois tests de concurrence ignorés sur SQLite (364 réussis). La suite d'interface
  compte désormais 123 tests réussis ; les 23 tests du connecteur passent également.
  Formatage, contrôles Django, absence de migration manquante et
  compilation de production vérifiés. Une réponse tardive de la bibliothèque ne
  fait plus disparaître un audio venant d'être importé.
- [x] **Chaîne Docker.** Construction des images, démarrage Nginx/API/Redis/Celery,
  connexion depuis Chrome, import fictif, workflows ASO/SMM, brouillon et exports
  vérifiés avec une base PostgreSQL 17 vierge. Compte, résultats, brouillon et exports
  conservés après `down` puis `up`, sans suppression des volumes. Le contrôle passe
  avec le Compose livré, sans surcharge, sur une nouvelle base `postgres:17-alpine`.
  Les 66 tests ciblant brouillons, workflows, recherche SMM et création concurrente
  du compte passent également avec cette image.
- [x] **Image PostgreSQL Alpine du Compose livré.** L'erreur `exec format error`
  provenait du cache local décompressé : le script d'entrée était vide dans le
  conteneur, mais intact dans l'archive de l'image (14 577 octets). Après sauvegarde,
  retrait de la seule image locale et nouveau téléchargement du même digest,
  le script et le démarrage fonctionnent. Aucun volume ni donnée utilisateur n'a
  été supprimé ; aucun changement d'image n'est nécessaire dans le projet.
- [x] **Connecteur 0.1.5 dans Chrome.** Chargement manuel, connexion aux tableaux
  de bord 5173 et 8080, et téléchargement du ZIP depuis Compose vérifiés. Les fichiers
  livrés correspondent aux sources. Les origines 5173, 8000 et 8080 sont couvertes
  par les tests. Le test réel a révélé deux boutons de fermeture superposés sur les
  Reels Facebook : le connecteur choisit maintenant le contrôle accessible. La lecture
  est limitée à la carte vidéo active pour exclure les compteurs des Reels préchargés.
  La version 0.1.5 est désormais requise sur les deux installations.
- [x] **Reprise de collecte dans la version assemblée.** Les collectes réelles et
  la sélection entre recherches ont été vérifiées sur l'installation de travail.
  Avec la 0.1.5 : arrêt après une capture, actualisation, reprise et achèvement avec
  six publications distinctes. Identifiant, date, texte et images de la première preuve
  restent identiques ; aucune nouvelle référence ne passe les filtres. Le Reel Sweepr
  conserve trois images et des compteurs inconnus, sans récupérer ceux du Reel suivant.
  Sur Compose/PostgreSQL, un plan préparé et le contexte public de MonTri ont été
  ajoutés au compte de test, sans copier de connexion IA. Arrêt après deux captures,
  actualisation, reprise et second arrêt après quatre publications distinctes vérifiés
  depuis Chrome. Les identifiants, dates, textes et empreintes des JPEG sont identiques
  pour les deux premières preuves, vérifiés par l'API HTTP. Ce test couvre la collecte
  et sa persistance ; il ne rejoue pas la planification ni l'analyse IA sur Compose.
  La vérification finale des filtres se termine via le worker avec zéro référence
  qualifiée. L'interface demande trois preuves qualifiées et bloque la génération.
  Le message d'activité est masqué lorsque la recherche est arrêtée ou terminée.
- [x] **Revue visuelle des parcours principaux.** Audit et éditeur de brouillon ASO,
  brief, workflow et éditeur SMM examinés dans Chrome sur écran large et à 390 px.
  Champs et actions restent accessibles ; comparaison ASO et étapes SMM s'empilent
  sur écran étroit. Les références réelles avec textes longs et captures, puis le lot
  MonTri UGC/carrousel/texte ont aussi été examinés à 390 px. Le débordement des
  grilles SMM est corrigé : la page reste à la largeur de l'écran et seule la bande
  de captures défile horizontalement.
- [x] **Erreurs et reprises ASO/SMM.** Un arrêt volontaire n'affiche plus une erreur
  ni une seconde demande d'arrêt. Une vérification navigateur bloque la finalisation
  automatique d'une collecte partielle : les captures restent conservées, avec reprise
  ou analyse explicite des publications disponibles. La connexion au navigateur est
  revérifiée avant démarrage et reprise. Les échecs de lecture des historiques, de
  l'activité et des connexions IA proposent un rechargement sans créer de tâche.
  Une panne de lecture des connexions n'est plus présentée comme un défaut de stockage
  des clés. Le rechargement permet aussi de récupérer une révision de connexion modifiée
  ailleurs. Les erreurs IA précisent quand réessayer et quand lancer une nouvelle tâche
  après changement de clé ou de modèle. Les cas de clé refusée et fournisseur indisponible
  ont été examinés dans Chrome avec des fixtures isolées, sans appel IA payant.
  Une coupure réelle de l'API Compose isolée affiche les erreurs de lecture IA et ASO ;
  après redémarrage, leurs boutons rechargent les connexions et l'historique avec succès.
  Les 33 tests des erreurs fournisseur passent ; 25 tests SMM/workflows et la compilation
  passent après la dernière correction d'affichage.

L'analyse actuelle couvre du texte et des captures partielles, sans vidéo ni audio
complets. La revue IA reste faillible : les résultats doivent être relus et les
corrections conservées. Étendre cette couverture est une amélioration ultérieure.

Le socle actuel conserve les sources, briefs, faits produit et journaux, et fournit des
scripts IA, plans éditables, médias, exports ZIP et MP4. Voir le
[parcours livré](smm.md). Ces outils pourront servir aux contenus
qui en ont besoin ; les extensions de montage et la synthèse vocale ne sont pas la
prochaine tranche.

### ASO : état actuel et évolutions ultérieures

Le module ASO est disponible et activable. Le premier audit contrôle les longueurs,
le budget de mots-clés et les répétitions exactes, avec sources Apple datées,
propositions de nettoyage copiables et limites de couverture explicites. Il conserve
l'import choisi et utilise le suivi commun en trois étapes. L'impact sur les téléchargements n'est pas évalué automatiquement.
La divergence Apple entre 100 octets et 100 caractères est présentée pour revue.
Les brouillons et la revue éditoriale OpenAI/Gemini/Claude sont implémentés, avec
choix explicite du modèle et propositions sourcées à relire. Le projet
ajoute un contrôle distinct des observations et propositions contre la fiche :
les déductions non étayées sont retirées, et les contrôles incomplets bloquent
l'enregistrement du rapport. Jusqu'à deux appels au modèle sont annoncés et
leur consommation est séparée. Sept cas fixes vérifient les erreurs de raisonnement
observées et les contre-exemples avant d'étendre ce contrôle.
Le banc de dix cas synthétiques comprend des contrôles automatiques,
de rapports relisibles et d'une grille de revue humaine. Les premiers critères
restent provisoires : la calibration par des spécialistes, les cas réels consentis
et un jeu réservé restent à faire. Voir [l'évaluation ASO](aso-evaluation.md).
La bibliothèque utilisée par l'IA contient cinq annotations de méthode et trois
exemples de fiches publiques, avec leurs limites et leur périmètre.
`Sources` permet d'inspecter les notes conservées pour
chaque audit et celles destinées aux nouveaux audits. Apple reste la référence
officielle ; Phiture, AppTweak et SplitMetrics apportent des méthodes de travail.
La suite porte sur les captures d'écran, cette calibration et les outils de recherche. La
[conception](architecture.md#conception-de-lagent-aso-spécialisé) prévoit un agent
spécialisé, une base documentaire sélectionnée et un graphe reliant règles,
observations, propositions et résultats. La première sélection inclut Apple,
Google, Phiture, AppTweak et SplitMetrics ; Google n'est pas injecté dans la revue
Apple. L'indexation et le graphe restent à implémenter.

La préparation des captures comprend désormais une [revue documentaire et trois
fiches examinées dans le navigateur](../addons/aso/knowledge/visual-research.json) :
Duolingo, Spotify et Tinder, dans trois domaines différents, le 17 octobre 2026.
Trois annotations textuelles issues de cette revue sont injectées dans les nouveaux
audits et visibles dans Sources ; les observations visuelles restent à intégrer.
La revue des affirmations distingue exemples et preuves propres à l'app.
La tranche recherche devra
ouvrir trois fiches à chaque exécution, afficher ses sources et sa couverture,
vérifier la pertinence des exemples, puis figer les observations avec l'audit.
Une consultation incomplète doit rester visible. Ajouter la recherche de niche
séparément ; les choix d'une grande app ne démontrent pas leur efficacité.
Voir les [critères du parcours](architecture.md#recherche-sur-trois-fiches-de-référence).

L'audit ASO reste utilisable indépendamment de SMM. Pour chaque store et
langue, distinguer les contraintes officielles vérifiables des recommandations
éditoriales : noms, sous-titres ou descriptions courtes, descriptions, mots-clés
quand disponibles, catégories et visuels. Chaque constat doit conserver le champ
observé, la règle ou recommandation, son lien officiel, la date de vérification
et une correction proposée. Signaler les données manquantes ou non vérifiables.
Les premières sources sont les recommandations Apple sur la
[fiche produit](https://developer.apple.com/app-store/product-page/) et la
[recherche App Store](https://developer.apple.com/app-store/search/), ainsi que la
[configuration des fiches Google Play](https://support.google.com/googleplay/android-developer/answer/9859152?hl=en).
Ne pas présenter une conformité de métadonnées comme une garantie de classement
ou de téléchargements. Les critères Apple et Google restent distincts ; un audit
Google complet reste à développer au-delà de l'import Google Play désormais disponible.

L'utilisateur relit les propositions avant toute application. Le connecteur Apple
actuel reste en lecture seule : les corrections sont copiables et à appliquer dans
App Store Connect, puis un nouvel import permet de vérifier les changements. Aucune
modification de fiche ni publication automatique n'est encore implémentée.

### Parcours ASO et brouillons

Parcours initial livré : l'utilisateur ouvre son app,
choisit la langue App Store, puis lance `Run audit`. Le contexte de l'app,
la langue et la date de dernière synchronisation restent visibles. Les résultats
présentent chaque problème avec le contenu actuel, une proposition concrète,
sa justification et ses sources. `Add to draft` crée un brouillon contenant uniquement
la proposition choisie ; l'utilisateur peut la modifier ensuite. `New draft` permet
aussi de partir de la langue importée choisie sans proposition automatique.

L'espace ASO propose `Audit`, `Drafts` et `Sources`, avec l'activité intégrée à l'audit. Le premier audit est
l'action principale de l'écran vide. Un brouillon suffit pour commencer ;
`Duplicate` permet de préparer une variante nommée, avec sauvegarde automatique
et historique consultable. L'éditeur compare l'import de référence ou le dernier import et le brouillon,
signale les différences par des libellés en plus des couleurs, affiche les limites
des champs et propose un aperçu. Sur petit écran, ces vues se suivent verticalement.
La fiche importée reste intacte ; une actualisation qui change la référence du
brouillon signale les écarts à relire, sans écraser le travail en cours.

Les actions de sortie sont `Copy changes`, `Export changes` et `Refresh and compare`
(ou comparaison de l'import enregistré si Connections est désactivé).
Elles accompagnent l'application manuelle dans la console du store.
`Draft`, `Ready` et la correspondance détectée dans l'import décrivent des faits distincts :
un brouillon validé n'est pas publié, un export n'est pas une publication, et une
correspondance à l'import ne confirme la mise en ligne que si le statut du store
le permet. La date de détection ne remplace pas la date réelle de publication.
Restaurer une ancienne révision du brouillon n'annule rien sur le store.

Les expériences et résultats viendront avec les intégrations nécessaires :
préparer deux variantes ne lance pas un test A/B. La méthode de mesure et les
champs testables dépendent du store. Une rubrique `Results` sera introduite quand
des données pourront être reliées aux changements, avec leur période et leurs
limites. `Activity` conserve l'historique des exécutions. Pendant un audit,
le suivi s'affiche directement dans le module, sans obliger l'utilisateur à
quitter son app : étapes, statut, action courante et résultats intermédiaires.

### Workflows et suivi des agents en direct

Le modèle d'interaction demandé reprend les graphes d'exécution de GitHub Actions
et les workflows de n8n. Chaque module fournit un parcours prêt à lancer.
Une suite courte utilise une liste d'étapes ; les dépendances, branches et tâches
parallèles utilisent un graphe. Cliquer une étape ouvre son activité, ses entrées,
ses résultats et ses sources. Le graphe d'exécution est distinct du graphe de
connaissances ASO, qui relie les recommandations à leurs preuves.

Exemple ASO : synchroniser la fiche, vérifier les règles et étudier les références
en parallèle quand leurs dépendances le permettent, préparer les propositions,
vérifier leurs preuves, puis remettre les corrections à l'utilisateur pour
composer son brouillon. L'état `Needs review` indique une intervention nécessaire,
avec son motif et les actions possibles. La préparation du brouillon ne publie rien.

Le journal en direct indique des actions observables : page ouverte avec son URL,
capture disponible, contrôle terminé, source inaccessible, proposition créée.
Une étape affiche `Queued`, `Running`, `Needs review`, `Completed`, `Failed`,
`Canceled` ou `Skipped`, sa durée et sa dernière activité. La progression
quantifiée repose sur un total connu ; une tâche longue sans total affiche son
action courante. Les coûts estimés restent distingués de la consommation rapportée.
Un contrôle déterministe est présenté comme tel, et non comme un agent IA.

L'utilisateur peut demander l'arrêt, consulter les résultats déjà disponibles,
et relancer une étape en échec lorsque la reprise est sûre. Une actualisation ou
la fermeture de l'onglet ne perd pas l'exécution. Les messages d'erreur indiquent
la cause utile et l'action possible. Les modules ASO et SMM partagent
ce suivi ; leurs étapes métier restent spécifiques. L'édition visuelle avancée
des workflows pourra venir ensuite, sur la même définition versionnée.

Références : [graphe GitHub Actions](https://docs.github.com/en/actions/how-tos/monitor-workflows/use-the-visualization-graph)
(capture officielle examinée) et
[historique des exécutions n8n](https://docs.n8n.io/build/understand-workflows/understand-executions/view-executions-for-a-single-workflow).
Le socle commun est maintenant implémenté dans SMM et ASO : trois étapes réelles,
journal SSE avec reconnexion et polling de secours, arrêt coopératif et reprise
des étapes inachevées avec les entrées originales. Les résultats terminés sont
réutilisés et la trace précédente est conservée. Le worker local utilise la base ;
Compose utilise Celery. Le pilotage du navigateur utilisateur et les étapes IA SMM
sont implémentés. Les branches parallèles, l'éditeur et une supervision autonome plus
étendue restent des évolutions ultérieures du socle partagé.

Les brouillons appartiennent à la base de données de l'installation et ne
nécessitent aucun compte GitHub. Dans ce parcours produit, la référence à GitHub
Actions désigne le suivi visuel des étapes. Les branches et pull requests du dépôt
concernent séparément le développement du code. Le workflow GitHub Actions
[`Checks`](../.github/workflows/ci.yml) existe déjà pour les tests, le formatage
et la compilation sur les push et pull requests ; les tâches métier s'exécutent
dans Panda Store.

Références consultées visuellement le 16 octobre 2026 :
[AppTweak Metadata Simulator](https://help.apptweak.com/en/articles/400809-test-your-keyword-selection-to-optimize-your-metadata)
pour les brouillons et les différences,
[Apple Product Page Optimization](https://developer.apple.com/app-store/product-page-optimization/)
pour l'aperçu de l'original et des variantes, et
[Google Publishing overview](https://support.google.com/googleplay/android-developer/answer/9859654?hl=en)
pour la séparation entre préparation, revue et publication. La capture Google
du [billet officiel de 2023](https://android-developers.googleblog.com/2023/01/control-when-changes-to-your-app-are-sent-for-review-with-new-play-console-features.html)
sert de référence de structure, pas de garantie sur l'apparence actuelle.

SMM dispose déjà de fournisseurs IA remplaçables et de sorties structurées.
La suite doit évaluer les adaptations par format à partir de références qualifiées,
avec un budget par recherche et génération. Conserver l'instantané de métadonnées
utilisé pour chaque résultat. Le mode démo reste disponible pour les tests sans clé payante.

Le connecteur Apple a été vérifié sur un compte réel avec une clé d'équipe
App Manager : catalogue, langues, icône, catégorie, captures et actualisation sans
doublon. Les clés individuelles restent à valider sur compte réel. Les imports
sont synchrones et limités ; prévoir des tâches pour les catalogues volumineux et
la synchronisation planifiée. La révocation des clés reste une action à effectuer
dans App Store Connect.

## Choix des fournisseurs et modèles IA

L'utilisateur doit pouvoir choisir OpenAI, Anthropic (Claude) ou Google (Gemini),
puis un modèle disponible chez ce fournisseur. Cette exigence s'applique aux
analyses ASO assistées par IA, au SMM et aux futurs agents. Le catalogue doit
être configurable et actualisable ; aucun modèle ni compte du développeur de
Panda Store ne doit être imposé dans une installation indépendante.

Chaque espace configure ses propres clés depuis l'interface, avec stockage chiffré
côté serveur. Un modèle par défaut peut être défini pour l'espace, puis remplacé
pour une tâche. Le choix doit tenir compte des capacités nécessaires (texte,
images, outils) et du budget. Si le modèle est indisponible ou incompatible,
afficher une erreur explicite ; ne pas envoyer les données à un autre fournisseur
sans choix de l'utilisateur. Conserver le fournisseur, l'identifiant exact du
modèle et la consommation dans chaque exécution pour permettre sa vérification.

## Conditions de réussite

- La veille conserve les URLs et dates, distingue publicité et publication
  organique, et indique les métriques réellement observables. Une vidéo très vue
  ne prouve pas qu'elle génère des installations.
- L'agent navigateur peut ouvrir et parcourir des pages autorisées, mais ne
  contourne ni authentification, ni restriction technique, ni droits d'accès.
  Le contenu des pages est une donnée non fiable, jamais une instruction.
- Dans la future version cloud, chaque publication exige des droits API disponibles pour le compte et une
  validation du contenu. Les audits des plateformes peuvent limiter l'accès.
- Une comparaison avant/après n'établit pas seule une causalité. La mesure doit
  exposer les biais, fenêtres de comparaison et limites d'attribution.
- Les modules de communauté conservent leurs licences et notices d'origine
  lorsqu'ils sont intégrés à une offre cloud commerciale.
