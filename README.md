# IV Now Playing

A free "now playing" widget for OBS from Infinite Variance. It shows the song playing on your PC, with its
cover, in one of four IV styles. No accounts, no Spotify developer keys, nothing online: it reads Windows'
own media controls, the same ones behind the media pop-up when you press a volume key.

Works with Spotify, Apple Music, TIDAL, YouTube Music (desktop apps or the web), Deezer, Amazon Music,
foobar2000, MusicBee and anything else that shows in Windows' media pop-up.

## Use it

1. Install and open IV Now Playing. It lives in the tray.
2. Pick a style, colours and when it shows. The preview is the real widget.
3. Copy the link and add a **Browser** source in OBS with it, at the size the app shows.

Each widget you make has its own link and look, so you can use different ones in different scenes.

## Styles

- **Strip**: a slim bar with the cover.
- **Card**: a big cover and big title.
- **Eye**: the cover sits in the IV eye.
- **Ticker**: a wide lower third.

Options: dark, light or no background; four fonts; size; cover square, round, spinning record or none;
colour from the cover, IV red or your own; hide when paused or show only when the song changes; eight
in and out animations; progress, times, album and player name; a message and picture for when nothing
plays; and which players count.

## How it works

- `resources/media-reader.ps1` uses built-in Windows PowerShell and WinRT to read every media session
  once a second (title, artist, album, position, cover). Read only.
- The app picks the session to show for each widget and serves the widget at
  `http://127.0.0.1:7766/w/<widget>` on this PC only. Other hosts and other websites are refused.
- Settings live in `%APPDATA%\IV Now Playing\settings.json`.

## Develop

```
npm install
npm start
npm test
node scripts/ui-check.mjs qa/ui-check          # made-up songs, throwaway settings
node scripts/ui-check.mjs qa/ui-check --real   # reads this PC's players (read only)
npm run dist                                   # Windows installer in dist/
```

Windows 10 or 11. MIT licence.
