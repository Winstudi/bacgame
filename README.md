# P'tit Bac

Jeu de Petit Bac multijoueur, pensé pour mobile. Serveur Node.js 22 avec Express et Socket.IO ; PostgreSQL conserve les comptes, les salons et la progression.

## Lancer le projet

1. Installer les dépendances avec `npm ci`.
2. Configurer `DATABASE_URL` pour le déploiement sur Render.
3. Lancer `npm start` ; la route `/health` indique l'état du serveur.

`npm test` exécute les tests automatiques. `npm run check` vérifie les sources et les fichiers publics. Le build Render est défini dans `render.yaml` et génère les bundles frontend avec `cleanup-frontend-build.cjs`.

## Repères dans le code

- `server.js` : serveur HTTP, connexion temps réel et déroulement des parties.
- `db.js`, `db-migrations.js` : connexion et schéma PostgreSQL.
- `quick-match-v2.js`, `game-loop-rules.js`, `room-mode-rules.js` : recherche et règles de partie.
- `account-auth.js`, `socket-security.js` : comptes et contrôle des messages temps réel.
- `*-service.js`, `*-hook.js` : fonctions serveur spécialisées.
- `index.html`, `app.js`, `mobile-runtime.js` : structure et noyau client.
- `salons.js` et `salons.css` : salons privé, public et rapide.
- `partie.js` et `partie.css` : catégories, roue, réponses, attente et résultats.
- `amis.js` et `amis.css` : amis et chat ; `profil.css` : styles du profil.
- `frontend-assets.cjs`, `public-files.json` : ordre de chargement et fichiers accessibles au navigateur.

## Configuration

`DATABASE_URL` est nécessaire sur Render. Les autres paramètres, comme les clés de validation automatique, sont des variables d'environnement du service et ne doivent pas être ajoutés au dépôt. Le serveur peut utiliser un comportement de secours quand le service de validation externe est indisponible.

La version actuelle est `1.48.0`. Les tests automatisés ne remplacent pas un essai multijoueur sur le site déployé.
