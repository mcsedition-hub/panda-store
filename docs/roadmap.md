# Feuille de route

Cette feuille de route exprime l'ordre proposé, pas des fonctions déjà livrées
ni des dates promises. Chaque étape doit livrer une boucle utilisable et testée.

| Étape | Résultat attendu | État |
| --- | --- | --- |
| Fondation | Espaces, modules, import fictif, brief, 3 scripts, export | Alpha implémentée |
| App réelle | App Store Connect, sélection d'apps, instantanés, erreurs de connexion | Import et actualisation validés sur un compte Apple réel avec une clé d'équipe |
| Audit ASO | Recommandations avec règle officielle, source, date et correction proposée | Contrôles Apple, revue IA de cinq champs, sources annotées, brouillons et évaluations implémentés ; captures et recherche à construire |
| Workflows | Étapes en direct, journal durable, arrêt et reprise | Socle partagé et Studio à modèles locaux implémentés ; agents et branches parallèles à construire |
| Création IA | Générations sourcées à partir d'une fiche auditée, 3 angles, suivi coût/durée, reprise et validation | À construire après l'audit ASO |
| Veille | Recherche concurrentielle et agent navigateur avec traces consultables | À construire |
| Google Play | Métadonnées et rapports via mécanismes officiels disponibles | À construire |
| Publication | Comptes sociaux, aperçu, validation, calendrier, statut d'envoi | À construire |
| Mesure | Liens de campagne, séries temporelles, rapports et limites d'attribution | À construire |
| Cloud | Exploitation, isolation renforcée, facturation, quotas, sauvegardes, support | À construire |

## Prochaine tranche

Le module ASO est disponible et activable. Le premier audit contrôle les longueurs,
le budget de mots-clés et les répétitions exactes, avec sources Apple datées,
propositions de nettoyage copiables et limites de couverture explicites. Il conserve
l'import choisi et utilise le suivi commun en trois étapes. Les captures et l'impact sur les téléchargements ne sont pas évalués automatiquement.
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
La bibliothèque utilisée par l'IA contient cinq annotations vérifiées, avec leurs
limites et leur périmètre. `Sources` permet d'inspecter les notes conservées pour
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
Ces notes ne sont pas encore injectées dans l'IA. La tranche recherche devra
ouvrir trois fiches à chaque exécution, afficher ses sources et sa couverture,
vérifier la pertinence des exemples, puis figer les observations avec l'audit.
Une consultation incomplète doit rester visible. Ajouter la recherche de niche
séparément ; les choix d'une grande app ne démontrent pas leur efficacité.
Voir les [critères du parcours](architecture.md#recherche-sur-trois-fiches-de-référence).

Auditer la fiche ASO avant de générer des scripts. Pour chaque store et
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
Google complet dépendra de l'import Google Play.

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
la cause utile et l'action possible. Les modules ASO, Studio et Veille partagent
ce suivi ; leurs étapes métier restent spécifiques. L'édition visuelle avancée
des workflows pourra venir ensuite, sur la même définition versionnée.

Références : [graphe GitHub Actions](https://docs.github.com/en/actions/how-tos/monitor-workflows/use-the-visualization-graph)
(capture officielle examinée) et
[historique des exécutions n8n](https://docs.n8n.io/build/understand-workflows/understand-executions/view-executions-for-a-single-workflow).
Le socle commun est maintenant implémenté dans Studio et ASO : trois étapes réelles,
journal SSE avec reconnexion et polling de secours, arrêt coopératif et reprise
des étapes inachevées avec les entrées originales. Les résultats terminés sont
réutilisés et la trace précédente est conservée. Le worker local utilise la base ;
Compose utilise Celery. La connexion des agents ASO et Veille, les sources et
captures dans le journal, les branches parallèles et l'éditeur restent à construire.

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

Après ce bilan ASO, ajouter un fournisseur IA remplaçable au Studio, des sorties
structurées, un budget par génération et des évaluations sur un jeu de briefs.
Utiliser l'instantané de métadonnées audité comme contexte des scripts et conserver
sa référence pour savoir sur quelle version ils reposent. Le fournisseur démo doit
rester disponible pour les tests sans clé payante.

Le connecteur Apple a été vérifié sur un compte réel avec une clé d'équipe
App Manager : catalogue, langues, icône, catégorie, captures et actualisation sans
doublon. Les clés individuelles restent à valider sur compte réel. Les imports
sont synchrones et limités ; prévoir des tâches pour les catalogues volumineux et
la synchronisation planifiée. La révocation des clés reste une action à effectuer
dans App Store Connect.

## Choix des fournisseurs et modèles IA

L'utilisateur doit pouvoir choisir OpenAI, Anthropic (Claude) ou Google (Gemini),
puis un modèle disponible chez ce fournisseur. Cette exigence s'applique aux
analyses ASO assistées par IA, au Studio et aux futurs agents. Le catalogue doit
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
- Chaque publication exige des droits API disponibles pour le compte et une
  validation du contenu. Les audits des plateformes peuvent limiter l'accès.
- Une comparaison avant/après n'établit pas seule une causalité. La mesure doit
  exposer les biais, fenêtres de comparaison et limites d'attribution.
- Les modules de communauté et leur accord de contribution doivent être prêts
  avant d'intégrer leur code dans une offre cloud commerciale.
