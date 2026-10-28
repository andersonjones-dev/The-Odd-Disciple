# The Odd Disciple

Bible-based party games for one phone, installable and fully offline.

- **The Odd Disciple**: impostor game, 3–10 players, 10 Scripture word packs (140 KJV-checked words), beginner/standard/hard difficulty, impostor gets a similar word or none.
- **Bible Mafia** (proposed name): Mafia-style, 5–12 players. Roles: Judas Iscariot (Traitor), Elijah (Protector), Pontius Pilate (Investigator), Disciple (Townsperson). All rules are provisional defaults.

No server, accounts or internet needed once loaded. Progress is saved on the device.

## Files (all go in the repo root)
`index.html` (the whole app), `sw.js` (offline cache), `manifest.webmanifest` (install info), `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`.

## Publish with GitHub Pages
1. Repo → **Add file → Upload files**, choose all files above, **Commit changes**.
2. Repo → **Settings → Pages → Source: Deploy from a branch → main / (root) → Save**.
3. After a minute or two the site is at `https://YOUR-USERNAME.github.io/REPO-NAME/`.

## Install on iPhone
Open that link in Safari → Share → **Add to Home Screen**. Open the app once while online; after that it works with no signal.

## Updating
Upload the new `index.html` (and `sw.js` if supplied) over the old ones. Change `VERSION` in `sw.js` too. Installed copies then show "A new version of The Odd Disciple is ready" with an **Update** button (`update.js`); nothing changes until it’s tapped.

## Known limits
- Fonts use the phone's built-in serif (no web fonts), so offline works with nothing to download. Custom fonts can be added later.
- Card artwork is placeholder line art. Role counts and other Mafia rules are untested starting points.
- A shared phone can't stop deliberate snooping; the app prevents accidental peeks.
