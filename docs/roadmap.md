# Feuille de route

Cette feuille de route exprime l'ordre proposé, pas des fonctions déjà livrées
ni des dates promises. Chaque étape doit livrer une boucle utilisable et testée.

| Étape | Résultat attendu | État |
| --- | --- | --- |
| Fondation | Espaces, modules, import fictif, brief, 3 scripts, export | Alpha implémentée |
| App réelle | App Store Connect, sélection d'apps, instantanés, erreurs de connexion | Import et actualisation validés sur un compte Apple réel avec une clé d'équipe |
| Audit ASO | Recommandations avec règle officielle, source, date et correction proposée | À construire |
| Création IA | Générations sourcées à partir d'une fiche auditée, 3 angles, suivi coût/durée, reprise et validation | À construire après l'audit ASO |
| Veille | Recherche concurrentielle et agent navigateur avec traces consultables | À construire |
| Google Play | Métadonnées et rapports via mécanismes officiels disponibles | À construire |
| Publication | Comptes sociaux, aperçu, validation, calendrier, statut d'envoi | À construire |
| Mesure | Liens de campagne, séries temporelles, rapports et limites d'attribution | À construire |
| Cloud | Exploitation, isolation renforcée, facturation, quotas, sauvegardes, support | À construire |

## Prochaine tranche

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
