# Feuille de route

Cette feuille de route exprime l'ordre proposé, pas des fonctions déjà livrées
ni des dates promises. Chaque étape doit livrer une boucle utilisable et testée.

| Étape | Résultat attendu | État |
| --- | --- | --- |
| Fondation | Espaces, modules, import fictif, brief, 3 scripts, export | Alpha implémentée |
| App réelle | App Store Connect, sélection d'apps, instantanés, erreurs de connexion | À construire |
| Création IA | Générations sourcées, 3 angles, suivi coût/durée, reprise et validation | À construire |
| Audit ASO | Recommandations avec règle officielle, source, date et correction proposée | À construire |
| Veille | Recherche concurrentielle et agent navigateur avec traces consultables | À construire |
| Google Play | Métadonnées et rapports via mécanismes officiels disponibles | À construire |
| Publication | Comptes sociaux, aperçu, validation, calendrier, statut d'envoi | À construire |
| Mesure | Liens de campagne, séries temporelles, rapports et limites d'attribution | À construire |
| Cloud | Exploitation, isolation renforcée, facturation, quotas, sauvegardes, support | À construire |

## Prochaine tranche

Brancher une application réelle en lecture seule avant de publier du contenu.
Ajouter une interface de connecteur, les droits minimaux nécessaires, le stockage
chiffré des identifiants, leur révocation et les erreurs de synchronisation.
Vérifier les accès avec un compte de test du propriétaire de l'app.

Ensuite, ajouter un fournisseur IA remplaçable au Studio, des sorties structurées,
un budget par génération et des évaluations sur un jeu de briefs. Le fournisseur
démo doit rester disponible pour les tests sans clé payante.

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
