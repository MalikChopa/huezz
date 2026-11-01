# Liste de contrôle des navigateurs (Huezz, J7)

Rien n'est affirmé ici sans test. Ce qui est vérifié par un script est dit tel quel ; le reste est à faire à la main, avec l'appareil.

## Vérifié automatiquement (2026-11-01)

- **Chrome (Mac, canal `chrome`, headless)** : `npm run check` (unitaires, 7 sorties d'export, 149 + 6 e2e : clavier, 390 et 320 px, ARIA, axe, CSP, hors ligne sur origine https fictive : 1 requête, 0 échec) ; fluidité (`npx vitest run tests/perf`) ; références visuelles (`npx vitest run tests/visual`, macOS seulement).
- **Moteur WebKit (build Playwright 2370, pas Safari lui-même)** : `tests/e2e/webkit.test.ts` (18 tests) : palette, Hasard, verrous, harmonie, base, contraste et Corriger, exports, PNG, lien, 390 et 320 px, cibles tactiles, mouvement réduit, axe. Une erreur de console connue (le `<select>` natif sous la CSP), sans effet visible mesuré.
- **Non fait par un script** : Safari réel, iPhone réel, Firefox, lecteur d'écran, zone sûre réelle, sélecteur de couleur natif, contenu du presse-papiers dans WebKit.

## À faire à la main (10 étapes courtes)

| # | Appareil | Étape | Résultat attendu |
|---|---|---|---|
| 1 | Safari Mac | Ouvrir `dist/index.html` (ou le site publié), regarder la console web. | La palette s'affiche et change au clic sur Hasard. Une seule erreur de CSP sur « stylesheet » est attendue (le `<select>`) ; aucune autre. |
| 2 | Safari Mac | Changer la couleur de base avec le sélecteur natif en faisant glisser. | Les 3 maquettes suivent en direct, sans saccade visible ; à la fermeture, un fondu court. |
| 3 | Safari Mac | Exporter, Copier (CSS), coller dans un éditeur ; Partager, coller le lien dans un nouvel onglet. | Le texte collé est celui de la zone ; le lien rouvre la même palette (14 couleurs identiques). |
| 4 | Safari iPhone | Ouvrir la page, tourner l'écran, vérifier le bas de page. | Pas de défilement horizontal ; le dock reste au-dessus de la barre d'accueil (zone sûre) ; barre sur 2 lignes. |
| 5 | Safari iPhone | Toucher la pastille de couleur de la barre (sélecteur natif), choisir une couleur. | La palette se met à jour ; le sélecteur n'est pas masqué par le clavier ni la barre. |
| 6 | Safari iPhone | Toucher le sélecteur d'harmonie, puis un champ de texte. | La liste native s'ouvre ; aucun zoom automatique de la page à la prise de focus (champs à 16 px). |
| 7 | Safari iPhone | Toucher une couleur du dock ; faire défiler le dock au doigt. | Toast « Copié » et couleur dans le presse-papiers (coller ailleurs) ; le dock s'arrête sur une colonne entière. |
| 8 | Safari iPhone | Exporter : choisir PNG, Télécharger. | Un fichier `huezz.png` de 1400 x 400 avec 7 bandes arrive dans Fichiers ou Photos. |
| 9 | Firefox (Mac ou Windows) | Ouvrir la page, Hasard, mode sombre, pastille de contraste, Corriger. | Même rendu qu'à Chrome (fondu des couleurs, `color-mix`, `:has()`), aucune erreur de console, Corriger atteint 4,5:1. |
| 10 | Lecteur d'écran (VoiceOver sur Mac ou iPhone) | Parcourir : titre, barre, pastilles, ouvrir la fenêtre de contraste, Hasard. | Noms et états annoncés (« Palette claire », « verrouillé », pastilles) ; une phrase courte « Nouvelle palette : accent #…, N sur 5 contrastes AA » après Hasard ; les maquettes sont lues comme 3 images. |

À consigner pour chaque étape : appareil, version du système et du navigateur, réussi ou non, capture si échec. Aucune de ces 10 étapes n'a été faite au 2026-11-01.
