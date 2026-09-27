# P'tit Bac

Jeu multijoueur mobile-first de Petit Bac, développé en Node.js avec Express, Socket.IO et PostgreSQL.

## État actuel

Version applicative : **1.48.0**

Le dépôt contient désormais directement le code réellement exécuté en production. Les anciennes transformations E2, E3, E4 et E5 ne sont plus nécessaires au déploiement.

Les principaux systèmes actifs sont :

- salons privés, salons publics et partie rapide ;
- profils, avatars, cadres et tags ;
- amis, invitations, messagerie et signalements ;
- portefeuille pièces/gemmes et vies rechargeables ;
- progression XP sur 50 niveaux ;
- validation automatique des réponses ;
- bots de test ;
- administration serveur ;
- sécurité Socket.IO avec rate limiting ;
- tests automatiques avant déploiement.

## Modes de jeu

### Partie rapide

Format fixe :

- 1 manche ;
- 6 catégories ;
- 60 secondes ;
- difficulté `medium` ;
- recherche automatique de joueurs ;
- économie et XP activées.

### Salon public

Salon créé par un joueur, visible par la recherche rapide lorsqu'il est rejoignable.

- économie activée ;
- XP activée ;
- 1 vie consommée au lancement réel ;
- bots interdits.

### Salon privé

Salon sur invitation/code.

- aucune vie consommée ;
- aucun gain de pièces ;
- aucun gain d'XP ;
- bots de test autorisés.

## Architecture

### Backend

- `server.js` : serveur HTTP, Socket.IO et logique principale de partie ;
- `db.js` : Pool PostgreSQL partagé ;
- `db-migrations.js` : schéma PostgreSQL central ;
- `presence-service.js` : présence temps réel commune aux amis et au chat ;
- `socket-security.js` : sécurité et limites de fréquence ;
- `inventory-service.js` : inventaire serveur ;
- `progression-service.js` : XP et niveaux ;
- `quick-match-v2.js` : recherche de partie rapide ;
- `economy-config.js` : valeurs officielles de l’économie et de la boutique ;
- `game-economy.js` : récompenses de fin de partie ;
- `friends-hook.js`, `chat-hook.js`, `admin-hook.js`, `player-report-hook.js` : modules serveur spécialisés.

### Frontend

`app.js` contient le noyau client. Les écrans modernes sont séparés dans leurs propres modules (`home-screen-v1.js`, `salons.js`, `answer-screen-v1.js`, etc.).

Le rendu dynamique utilise un bus commun :

- `ptitbac:screen-rendered`
- `ptitbac:dom-updated`

Cela évite plusieurs `MutationObserver` concurrents.

## Base de données

Configurer `DATABASE_URL` sur Render.

Un seul Pool PostgreSQL est créé dans `db.js` puis partagé par les modules serveur.

Depuis E8, toutes les créations et évolutions de tables sont centralisées dans `db-migrations.js`. Les modules fonctionnels ne créent plus leurs propres tables.

`ptitbac_wallets` est la source de vérité pour les pièces et les gemmes. L'ancien champ `public.users.coins` est migré puis supprimé automatiquement.

La présence en ligne des amis et du chat est partagée via `presence-service.js`.

Le panneau admin et les récompenses de boîte de réception utilisent désormais le même inventaire officiel (`ptitbac_inventory_items`) que le joueur.

## OpenAI

Variables principales :

- `OPENAI_API_KEY`
- `OPENAI_VALIDATION_MODEL` (optionnel)
- `OPENAI_VALIDATION_REVIEW_MODEL` (optionnel)
- `OPENAI_BOT_API_KEY` (optionnel)
- `OPENAI_BOT_MODEL` (optionnel)
- `BOT_AI_ENABLED` (`true` / `false`)

Sans clé pour les bots, le jeu utilise son générateur local.

## Autres variables utiles

- `DATABASE_URL`
- `PTITBAC_ADMIN_CODE`
- `SOCKET_CORS_ORIGIN`
- `PTITBAC_DB_POOL_MAX`
- `REWARDED_AD_DEV_MODE`

Ne jamais stocker de clé privée directement dans GitHub.




## Progression de fin de partie — 1.46.1

Les pièces ne sont plus attribuées à la fin d'une partie.

Une partie Quick/Public éligible donne désormais :

- XP selon les manches, réponses valides et classement ;
- trophées selon le classement : 1er +10, 2e +6, 3e +3, autres +1.

Le salon privé et les parties avec bots ne donnent ni XP ni trophées.

La 1.46.1 renforce aussi la stabilité en partie :

- réponses restaurées après reconnexion ;
- chrono basé sur l'heure serveur ;
- validation IA limitée par un délai maximal avec fallback automatique ;
- distribution XP/trophées idempotente.

## Boucle de jeu 1.46

La boucle multijoueur a été renforcée :

- en Quick, aucun clic d'un hôte technique n'est requis sur l'écran des résultats ;
- un hôte déconnecté peut se reconnecter pendant 15 secondes avant qu'un autre humain connecté prenne le relais ;
- quitter pendant le choix des catégories ou de la lettre ne rembourse pas la vie consommée ;
- lors d'un duel interrompu en cours de partie, le joueur qui reste récupère sa vie tandis que l'abandonneur conserve le coût de son entrée ;
- quitter après la dernière manche valide d'abord la fin de partie afin de ne pas perdre les récompenses ;
- les principaux boutons de sortie attendent désormais la confirmation du serveur avant d'effacer la session locale.

## Santé du service

`GET /health` permet au site et à la future application mobile de vérifier le
backend. La réponse contient notamment :

- la version applicative ;
- le commit Render réellement déployé (`RENDER_GIT_COMMIT`) ;
- l'état PostgreSQL ;
- le type de stockage actif ;
- l'uptime du processus.

Sur Render, PostgreSQL est obligatoire. Si `DATABASE_URL` est absent ou si
l'initialisation PostgreSQL échoue, le serveur refuse désormais de démarrer au
lieu de basculer silencieusement sur un fichier JSON local.

Le fallback JSON reste disponible uniquement pour le développement local et
les tests.

## Tests

```bash
npm test
npm run check
```

`npm test` lance les fichiers `*.test.cjs`.

Les tests couvrent notamment :

- quick-match ;
- modes public/privé/rapide ;
- inventaire ;
- progression ;
- économie ;
- sécurité Socket.IO ;
- démarrage réel du serveur via `/health`.

## Déploiement Render

Le build actuel suit cette chaîne :

```text
npm ci
→ npm test
→ npm run check
→ cleanup-frontend-build.cjs
→ npm run check:production
→ optimisation WebP
→ npm start
```

`cleanup-frontend-build.cjs` ne réécrit plus la logique du jeu. Il regroupe seulement certains fichiers frontend en bundles de production.

## Assets

Les fichiers publics sont explicitement listés dans `public-files.json`.

Les gros PNG sont convertis en WebP pendant le build lorsque `sharp` est disponible. Les URL PNG restent compatibles grâce au serveur.

## Règle de maintenance

Le code présent dans GitHub doit rester la source de vérité.

Ne pas réintroduire de système qui modifie `server.js`, `app.js`, `style.css` ou les modules fonctionnels pendant le build.


## Correctif de nettoyage et de sécurité — septembre 2026

Les corrections sont directement intégrées aux sources. Ne pas exécuter les anciens
scripts `apply-stabilisation-1.49*.cjs` après cette mise à jour.

- `npm ci --include=dev` installe aussi les outils des tests utilisés au build.
- Les migrations de l’inventaire, des quêtes, de la boutique et des récompenses sont centralisées.
- Les comptes enregistrés doivent présenter une session valide, y compris à la connexion Socket.IO.
- Le propriétaire admin déjà enregistré est conservé. Une adresse e-mail déclarée ne donne plus de rôle.
  Pour provisionner un propriétaire sur une nouvelle base, définir `PTITBAC_ADMIN_USER_ID` avec
  l’UUID du profil utilisateur existant (`public.users.id`), pas son e-mail ou son code ami.
- Les connexions PostgreSQL distantes vérifient le certificat. Si l’hébergeur utilise une autorité
  privée, fournir son certificat CA via `PTITBAC_DB_CA`.
- La remise à zéro globale n’est plus déclenchée par le démarrage du serveur.
- `shop:claimAdBag` reste indisponible tant qu’une preuve publicitaire serveur n’est pas intégrée.
- `sql-integration.test.cjs` exécute les migrations et des parcours sur PostgreSQL embarqué PGlite.
  Cela ne remplace pas les tests de connexion/TLS et de concurrence sur le PostgreSQL de l’hébergement.

Les quêtes anciennes restent cumulatives ; le chargement de leurs statistiques regroupe les requêtes.
Les règles récentes de bots de matchmaking priment sur les descriptions historiques ci-dessus :
un humain avec des bots de matchmaking peut recevoir de l’XP, mais pas de trophées compétitifs.
Les images et feuilles CSS existantes ne sont pas modifiées par ce correctif.

## Convivialité — revanche, septembre 2026

Dans les salons privés et publics, la fin de partie propose « Je rejoue »
(annulable) et affiche le nombre d'humains connectés partants. Lorsque tous
ont accepté, l'hôte peut ramener le groupe au même salon, avec le même code
et les mêmes paramètres. La prochaine partie conserve la validation « Prêt »
du salon. Les bots ne votent pas ; une déconnexion annule le vote du joueur.
Les groupes persistants et les nouveaux modes ne sont pas inclus dans ce lot.

En partie rapide, « Rejouer » recherche de nouveaux adversaires seulement
après confirmation de sortie du salon précédent. Si la sortie échoue, la
session reste disponible et le bouton permet de réessayer.

Validation de ce lot : tests ciblés des règles, transitions et protections
Socket.IO, ainsi que `node ci-check.cjs`. Le parcours réel à plusieurs iPhone
reste à vérifier après installation. Aucun nouveau fichier source requis.

## Groupes d'amis persistants — septembre 2026

Dans **Amis → Mon groupe**, créer un groupe puis sélectionner un ami et l'inviter.
L'invitation doit être acceptée ; elle expire après cinq minutes. Un groupe
contient au maximum six joueurs et chaque joueur appartient à un seul groupe.
Les membres sont sauvegardés dans PostgreSQL : retourner à l'accueil, se
reconnecter ou redémarrer le serveur ne dissout pas le groupe.

Le responsable peut préparer un salon privé ou partager celui qu'il héberge.
Les membres retrouvent « Rejoindre le salon » dans Amis : ils rejoignent à leur
initiative, sans nouvelle invitation et sans quitter automatiquement une partie
en cours. Après une partie, la revanche garde le salon existant ; si tous sont
revenus à l'accueil, le responsable peut en préparer un autre pour le groupe.
Quitter le groupe ne quitte pas la partie en cours. Si le responsable quitte
le groupe, le membre le plus ancien prend sa place. Le dernier départ supprime
le groupe. Un salon fermé ou devenu public n'est plus proposé au groupe.

Les tables sont créées automatiquement par les migrations habituelles, sans
commande SQL manuelle. Ce lot contient aussi le correctif de revanche précédent.
Il n'ajoute ni mode Sprint ni parties à thème.

Tests : suite automatisée incluant PostgreSQL embarqué, contrôle des fichiers
et contrôle syntaxique de l'interface. La vérification visuelle et un essai réel à plusieurs iPhone restent
nécessaire après déploiement. Le test PostgreSQL distant nécessite une base
de test explicitement configurée ; il n'a pas été exécuté dans cette livraison.
