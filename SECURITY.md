# Sécurité

Cette alpha est destinée aux démonstrations locales et au développement.
Elle ne doit pas encore être exposée comme service public avec des données client.
Elle ne stocke aucune clé Apple, Google ou fournisseur IA.

Les contrôles présents incluent les sessions Django, CSRF, les rôles, les filtres
par espace, les secrets locaux aléatoires et la validation des manifestes.
Le proxy Compose limite les tentatives sur la connexion ; `runserver` n'inclut
pas cette limitation. Le compte de démo n'est pas un administrateur Django.

Avant une offre publique : HTTPS et cookies sécurisés, stockage des secrets,
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
