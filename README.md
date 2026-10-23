# Devine la recherche

Jeu multijoueur en ligne, chacun sur son écran. Une room se rejoint avec un code de 4 lettres (ou un lien d'invitation).

## Déroulé d'une manche

1. Chaque joueur reçoit une image secrète, trouvée avec une vraie recherche (ex. « chat qui dort sur un clavier »).
2. Il écrit la recherche qu'il imagine derrière l'image.
3. Sa phrase est envoyée à un autre joueur, qui voit 4 images et doit retrouver la bonne.
4. Points : bonne image trouvée = +1 pour celui qui devine et +1 pour l'auteur. Chaque mot de la vraie recherche retrouvé par l'auteur = +1 (max 3).

Tout le monde joue en même temps, le joueur à qui l'on passe sa phrase change à chaque manche. L'hôte (👑) règle le nombre de manches et les chronos.

## Lancer en local

```bash
npm install
npm start          # http://localhost:3000
npm test           # simule une partie complète à 3 joueurs
```

## Source des images

Choisie automatiquement selon les variables d'environnement (ou forcée avec `IMAGE_PROVIDER`) :

| Provider | Variables | Remarques |
|---|---|---|
| `google` | `GOOGLE_API_KEY`, `GOOGLE_CX` | Google Custom Search JSON API. Fermée aux nouveaux clients, arrêt prévu le 1er janvier 2027. |
| `brave` | `BRAVE_API_KEY` | Brave Search API (images), résultats proches de Google. |
| `openverse` | aucune | Par défaut. Images libres de droits, sans clé, limité en nombre de requêtes. |
| `demo` | aucune | Hors ligne : images faites d'emojis, pour tester. |

Si la source échoue, le jeu bascule sur `demo` pour ne pas bloquer la partie. Les recherches secrètes sont dans `server/queries.js`.

## Mettre en ligne sur Render (gratuit)

1. Crée un compte sur https://render.com en te connectant avec GitHub.
2. Dans le tableau de bord, clique sur **New +** puis **Blueprint**.
3. Choisis le dépôt `devine-la-recherche`. Render lit le fichier `render.yaml` et prépare le service tout seul.
4. Il te demande `BRAVE_API_KEY` : laisse vide pour utiliser Openverse (sans clé), ou colle ta clé Brave.
5. Clique sur **Apply**. Après 2 à 3 minutes, l'adresse du jeu s'affiche (du type `https://devine-la-recherche.onrender.com`). Envoie-la à tes amis.

Bon à savoir : sur l'offre gratuite, le serveur s'endort après 15 minutes sans visite. Le premier qui ouvre le lien attend environ 30 secondes, ensuite tout est fluide. Les rooms sont en mémoire, donc une partie en cours est perdue si le serveur redémarre.

Chaque `git push` sur la branche principale redéploie automatiquement le jeu.

## Structure

- `server/index.js` : serveur Express + Socket.IO, gestion des rooms
- `server/game.js` : règles du jeu (manches, attribution, score)
- `server/images.js` : sources d'images
- `public/` : interface web (HTML/CSS/JS sans framework)
