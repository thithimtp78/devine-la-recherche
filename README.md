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

## Mettre en ligne

N'importe quel hébergeur Node qui supporte les WebSockets convient (Render, Railway, Fly.io…). Sur Render : « New Web Service », build `npm install`, start `npm start`. Les rooms sont gardées en mémoire, donc une seule instance.

## Structure

- `server/index.js` : serveur Express + Socket.IO, gestion des rooms
- `server/game.js` : règles du jeu (manches, attribution, score)
- `server/images.js` : sources d'images
- `public/` : interface web (HTML/CSS/JS sans framework)
