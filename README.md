# Devine la recherche

Jeu multijoueur en ligne, chacun sur son écran. Une room se rejoint avec un code de 4 lettres (ou un lien d'invitation).

**Jouer :** https://thithimtp78.github.io/devine-la-recherche/

## Déroulé d'une manche

1. Chaque joueur reçoit une image secrète, trouvée avec une vraie recherche (ex. « chat qui dort sur un clavier »).
2. Il écrit la recherche qu'il imagine derrière l'image.
3. Sa phrase est envoyée à un autre joueur, qui voit 4 images et doit retrouver la bonne.
4. Points : bonne image trouvée = +1 pour celui qui devine et +1 pour l'auteur. Chaque mot de la vraie recherche retrouvé par l'auteur = +1 (max 3).

Tout le monde joue en même temps, le joueur à qui l'on passe sa phrase change à chaque manche. L'hôte (👑) règle le nombre de manches et les chronos.

## Comment ça marche sans serveur

Le site est 100 % statique (dossier `docs/`, publié par GitHub Pages). Le navigateur de celui qui crée la room fait tourner la partie, les autres s'y connectent en direct (WebRTC, via [PeerJS](https://peerjs.com) et son service public gratuit de mise en relation). Le code de room sert d'adresse.

- Si un joueur rafraîchit sa page, il revient dans la partie.
- Si l'hôte rafraîchit sa page, la room est recréée avec le même code (la partie en cours repart de la salle d'attente) et les autres reviennent tout seuls.
- Si l'hôte ferme son onglet, la partie s'arrête pour tout le monde.

## Source des images

Recherchées depuis le navigateur de l'hôte, sans clé : [Openverse](https://openverse.org) (images libres de droits), puis Wikimedia Commons en secours, et en dernier recours des images en emojis pour que la partie ne bloque jamais. Les recherches secrètes sont dans `docs/queries.js`.

Pour tester sans réseau : ajoute `?images=demo` à l'adresse.

## Publier sur GitHub Pages

Dans le dépôt : **Settings → Pages → Build and deployment**, Source « Deploy from a branch », branche `main`, dossier `/docs`, puis **Save**. Le site est en ligne une minute plus tard, et chaque push sur `main` le met à jour.

## Développement

```bash
npm install
npm start        # sert docs/ sur http://localhost:3000
npm test         # simule une partie à 3 joueurs sur la logique du jeu
npm run e2e      # 3 navigateurs jouent une partie complète (serveur PeerJS local)
```

## Structure

- `docs/game.js` : règles du jeu (manches, attribution, score)
- `docs/net.js` : connexion hôte / joueurs en pair-à-pair
- `docs/images.js` : sources d'images
- `docs/app.js`, `index.html`, `style.css` : interface
