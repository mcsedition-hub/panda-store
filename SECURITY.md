# Sécurité

Cette alpha est destinée aux démonstrations locales et au développement.
Elle ne doit pas encore être exposée comme service public avec des données client.
Les clés App Store Connect, Google Play et les clés IA sont chiffrées en base avec
Fernet et une clé propre à l'installation (`PANDA_CREDENTIAL_KEYS`), distincte de
la clé de session Django.

Les contrôles présents incluent les sessions Django, CSRF, les rôles, les filtres
par espace, les secrets locaux aléatoires et la validation des manifestes.
Seul le propriétaire d'un espace peut ajouter, remplacer ou supprimer ses clés
Apple, Google Play et IA. Elles ne sont jamais renvoyées par l'API ni placées dans le stockage navigateur.
Le connecteur Apple utilise des JWT ES256 de deux minutes limités aux requêtes GET.
Il refuse les redirections et les liens de pagination vers un autre hôte ou chemin.
Une erreur d'import conserve le dernier instantané ; une modification ou suppression
de connexion pendant un import empêche l'enregistrement de ses résultats périmés.

Google Play utilise un compte de service dédié et un échange OAuth vers les hôtes
Google fixes. La lecture des fiches nécessite la création puis la suppression d'une
session d'édition temporaire. Aucune publication ni modification de fiche n'est
envoyée. Une nouvelle session peut invalider une autre session du même compte :
ne pas partager ce compte de service avec un outil de publication. Une réservation
temporaire empêche les imports simultanés du même compte dans cette installation.

Sauvegarder la base et les clés de chiffrement séparément. Ne pas remplacer une
clé de chiffrement existante au redémarrage. Pour une rotation, placer la nouvelle
clé en tête de `PANDA_CREDENTIAL_KEYS`, suivie de l'ancienne, séparées par une virgule.
Les nouvelles écritures utilisent la première ; conserver les anciennes tant que
des identifiants ou sauvegardes les utilisent. Il n'existe pas encore d'outil de
réencryption globale. Déconnecter dans Panda Store ne révoque pas la clé chez Apple.
Le proxy Compose limite les tentatives sur la connexion ; l'API lancée directement
avec Uvicorn ou `runserver` n'inclut pas cette limitation. Le compte de démo n'est pas
un administrateur Django.

La configuration locale active `PANDA_SETUP_ENABLED=true` pour créer une organisation
et son propriétaire au premier lancement. Conserver la liaison à localhost fournie
par Vite, Uvicorn et Compose : le premier visiteur peut configurer une installation
vide. L'assistant est protégé par CSRF ; une transaction et un enregistrement unique
empêchent une seconde configuration. Seul l'ancien compte de démo non administrateur,
isolé dans son espace prédéfini, peut être repris ; les autres bases avec des comptes
existants ne peuvent pas être réinitialisées par cet assistant.

Le mot de passe passe par les validateurs et le hachage Django. Le propriétaire de
l'espace n'est pas un administrateur Django. Après configuration, les sessions,
les rôles et l'isolation des espaces restent requis. L'ancienne ouverture automatique
sans mot de passe a été retirée. L'e-mail reste local, sans vérification ni récupération
de mot de passe par e-mail à ce stade.

Avant une offre publique : HTTPS et cookies sécurisés, gestion opérationnelle des secrets,
gestion des invitations/révocations, limitation distribuée des requêtes,
observabilité, journal d'audit, sauvegardes et restauration testées, budgets
de tâches et revue de l'isolation doivent être complétés.

Les modules installés sont du code Python de confiance. Ne pas installer un
module inconnu sans revue. Les workflows détectent les baux expirés après un arrêt
de worker et proposent une reprise explicite des étapes inachevées. Ils ne relancent
pas automatiquement un appel IA payant. Les brouillons ASO et storyboards détectent
les conflits de version ; l'édition d'un même script SMM ne dispose pas encore de
ce contrôle.

La recherche SMM transmet au fournisseur IA choisi le contexte confirmé de l'app,
le texte capturé et des vues de l'onglet de recherche. Les mots de passe et cookies
sociaux ne sont pas exportés. Les sources web sont traitées comme des données non
fiables ; elles n'autorisent aucune commande arbitraire. Voir les
[limites du connecteur](addons/studio/browser_extension/README.md).

Ne pas publier les détails exploitables d'une vulnérabilité dans une issue.
Utiliser « Report a vulnerability » dans l'onglet Security du dépôt si le
signalement privé y est activé. Sinon, ouvrir une demande générique de canal
privé sans détails, secrets ni données clients. Aucun délai de réponse n'est
garanti pour cette alpha.
