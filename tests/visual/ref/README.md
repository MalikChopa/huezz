# Références visuelles (maquette B)

Copies de `maquette/shots/b-1440.png` (1440 x 900) et `b-390.png` (390 x 844), prises sur la maquette `maquette/b/index.html` (le dossier `maquette/shots/` reste ignoré par git). Dimensions relues avec `file` : 1440 x 900 et 390 x 844, RVB 8 bits.

## État capturé

- Palette **Lagune** (tableau `P`, id `lagune` de la maquette ; harmonie complémentaire), **mode clair**, thème système clair, aucune fenêtre ni menu ouvert, DPR 1.
- Les 14 couleurs (non produites par le générateur) :
  - clair : fond `#F5F8F7`, surface `#FFFFFF`, texte `#0E1F1D`, accent `#0F7C74`, accent2 `#D95A4E`, succès `#2C7A3F`, alerte `#B93A2B` ;
  - sombre : fond `#0B1413`, surface `#142120`, texte `#E4EFED`, accent `#42C2B3`, accent2 `#F08D7F`, succès `#62C97F`, alerte `#F2796A`.
- Ces images montrent aussi ce que Huezz n'a pas encore (pastilles WCAG, boutons « Copier le lien » et « Exporter », nom « Lagune ») : ces zones comptent comme différences dans la comparaison de la fenêtre entière, pas dans celle de la scène.
- L'état exact de la capture d'origine (écran, thème système) n'a pas été consigné par l'auteur de la maquette : « clair, thème système clair » est la lecture des images, pas un fait relevé à la source.

## Références figées de l'application actuelle (J7) : `frozen-*.png`

Fichiers : `frozen-1440-light.png`, `frozen-1440-dark.png`, `frozen-390-light.png`, `frozen-390-export.png`. Produits par `tests/visual/frozen.test.ts`, à partir de `dist/index.html` (`npm run build` avant), sur `darwin` seulement.

État capturé (exact) :
- Chrome installé (`channel: 'chrome'`, headless), **DPR 1**, fenêtre **1440 x 900** ou **390 x 844** (sans émulation tactile : seule la largeur compte pour les règles CSS), `file://`, sans contourner la CSP, `prefers-reduced-motion: no-preference`.
- Hash fixe (couleurs fixes, graine `00c0ffee`, harmonie complémentaire) : `#v=1&m=<l|d>&h=co&s=00c0ffee&k=00&l=F5F8F7FFFFFF0E1F1D0F7C74D95A4E2C7A3FB93A2B&d=0B1413142120E4EFED42C2B3F08D7F62C97FF2796A` (les 14 hex de la palette Lagune de la maquette B, lien écrit à la main, valide).
- Thème système : **clair** pour `1440-light`, `390-light`, `390-export` (mode `m=l`) ; **sombre** pour `1440-dark` (mode `m=d`).
- `390-export` : après chargement, clic sur « Exporter » : la feuille du bas est ouverte sur le format CSS (le dock est masqué par conception sous une feuille) ; le focus est retiré (`blur`) pour qu'aucun anneau ne soit visible.
- Attente 0,8 s après `html.is-ready` (fondu de 0,3 s terminé) puis 0,5 s après l'ouverture de la feuille ; **pointeur placé en (0, 0)** (aucun survol), aucun focus visible, aucune fenêtre de contraste, aucun toast, aucune animation en cours.
- Seuil de régression : **<= 0,5 % de pixels différents** sur l'image entière (un pixel compte si un canal diffère de plus de 16/255), et deux captures successives de la même page doivent aussi s'accorder à 0,5 %.
- Mise à jour volontaire : `UPDATE_VISUAL=1 npx vitest run tests/visual/frozen.test.ts`, puis regarder les images et relire le diff Git.
- Dépendances : police système de macOS et moteur de Chrome ; une mise à jour de l'un des deux peut déplacer des pixels (le seuil de 16/255 absorbe l'anticrénelage, pas un changement de police).

## Mise à jour J12 (brief 25, 2026-11-02) : titre = nom de la palette, sélecteur « Vision »

Les 4 références `frozen-*.png` ont été régénérées (`UPDATE_VISUAL=1 npx vitest run tests/visual/frozen.test.ts`), après comparaison de chaque ancienne image avec la nouvelle (seuil de 16/255 par canal, comme le test). Les nouvelles images ont été regardées une par une.

- **`frozen-1440-light`** : 6 940 pixels différents (0,535 %), tous dans deux zones : le titre de la scène (« Palette générée » devient « Terre turquoise », zone x 32–351, y 112–175, 5 979 pixels) et le nouveau sélecteur « Vision » avec son libellé (x 1 072–1 263, y 64–111, 961 pixels). Aucun autre pixel ne change : la hauteur de l'en-tête de scène (95,39 px) et la boîte de la scène sont identiques.
- **`frozen-1440-dark`** : 5 915 pixels différents : titre (« Néon turquoise », x 48–351, y 112–175, 4 957) et sélecteur (x 1 072–1 263, y 64–111, 958). Rien d'autre.
- **`frozen-390-light`** et **`frozen-390-export`** : ICI LES DIFFÉRENCES NE SE LIMITENT PAS au titre et au sélecteur. Sur téléphone, le sélecteur doit faire 44 px de haut (cible tactile) : la rangée du libellé « Contraste WCAG » passe de 17,4 à 44 px, donc tout ce qui est dessous descend de 26,6 px. 65 312 pixels différents (19,8 %) pour `390-light` (zone y 143–743) et 23 441 (7,1 %) pour `390-export` (zone y 143–678, le dessous de la feuille d'export est caché). Contrôle : l'image ancienne décalée de 27 px vers le bas redonne la nouvelle sous la rangée des pastilles avec 2 457 pixels différents sur 171 600 (1,4 %, le décalage réel n'est pas un nombre entier de pixels : anticrénelage du texte) ; sans décalage, 19,8 %. C'est donc un décalage vertical voulu, pas un autre changement.
- Titre de chaque image : le nom vient des couleurs de la palette Lagune du lien écrit à la main (accent #0F7C74, fond #F5F8F7 clair ou #0B1413 sombre) : « Terre turquoise » (clair), « Néon turquoise » (sombre).
- La première ligne du CSS dans `frozen-390-export` dit maintenant « Huezz : palette Terre turquoise, harmonie… » (le nom est ajouté dans les exports).
