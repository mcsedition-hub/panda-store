# Sécurité

Cette alpha est destinée aux démonstrations locales et au développement.
Elle ne doit pas encore être exposée comme service public avec des données client.
Les clés App Store Connect saisies dans Connections sont chiffrées en base avec
Fernet et une clé propre à l'installation (`PANDA_CREDENTIAL_KEYS`), distincte de
la clé de session Django. Aucune clé Google ou de fournisseur IA n'est encore gérée.

Les contrôles présents incluent les sessions Django, CSRF, les rôles, les filtres
par espace, les secrets locaux aléatoires et la validation des manifestes.
Seul le propriétaire d'un espace peut ajouter, remplacer ou supprimer ses clés
Apple. Elles ne sont jamais renvoyées par l'API ni placées dans le stockage navigateur.
Le connecteur utilise des JWT ES256 de deux minutes limités aux requêtes GET.
Il refuse les redirections et les liens de pagination vers un autre hôte ou chemin.
Une erreur d'import conserve le dernier instantané ; une modification ou suppression
de connexion pendant un import empêche l'enregistrement de ses résultats périmés.

Sauvegarder la base et les clés de chiffrement séparément. Ne pas remplacer une
clé de chiffrement existante au redémarrage. Pour une rotation, placer la nouvelle
clé en tête de `PANDA_CREDENTIAL_KEYS`, suivie de l'ancienne, séparées par une virgule.
Les nouvelles écritures utilisent la première ; conserver les anciennes tant que
des identifiants ou sauvegardes les utilisent. Il n'existe pas encore d'outil de
réencryption globale. Déconnecter dans Panda Store ne révoque pas la clé chez Apple.
Le proxy Compose limite les tentatives sur la connexion ; `runserver` n'inclut
pas cette limitation. Le compte de démo n'est pas un administrateur Django.

La configuration locale active `PANDA_SETUP_ENABLED=true` pour créer une organisation
et son propriétaire au premier lancement. Conserver la liaison à localhost fournie
par Vite, runserver et Compose : le premier visiteur peut configurer une installation
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
module inconnu sans revue. Le verrouillage applicatif des générations ne fournit
pas encore la récupération automatique après un crash de worker, ni un contrôle
de conflit lors d'éditions concurrentes d'un même script.

Ne pas publier les détails exploitables d'une vulnérabilité dans une issue.
Utiliser « Report a vulnerability » dans l'onglet Security du dépôt si le
signalement privé y est activé. Sinon, ouvrir une demande générique de canal
privé sans détails, secrets ni données clients. Aucun délai de réponse n'est
garanti pour cette alpha.
