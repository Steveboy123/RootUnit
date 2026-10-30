# YouTube Music

YouTube Music is integrated directly into the **Music** screen. The old general YouTube launcher and the separate **Apps** page were removed.

## What works

- Search music from the head-unit UI
- Browse matching public playlists
- Open a playlist and load up to its first 50 playable items
- Play/pause, previous/next, seek and volume
- Add songs to a local queue
- Recently played list stored in the browser on the head unit
- Automatically pauses the normal Spotify/TIDAL source and radio when YouTube Music starts
- Works in the Windows test UI and Chromium on Raspberry Pi

Playback uses the official **YouTube IFrame Player API**. Search and playlist metadata use **YouTube Data API v3**. This avoids scraping or unofficial YouTube Music endpoints.

## First-time setup

1. Open the head unit and choose **Music → YouTube Music**.
2. Tap **Enable YouTube API** and enable **YouTube Data API v3** in a Google Cloud project.
3. Create an API key under Google Cloud credentials.
4. Paste the key into the YouTube Music setup card and tap **Save**.

The key is stored in `data/youtube.json` with the other local head-unit data and is only used by the Node backend when calling Google. It is not returned to the browser after saving.

You may alternatively set `YOUTUBE_API_KEY` in `.env`; a key saved from the UI takes priority over the environment value.

## Important API limitation

Google does not expose a public YouTube Music API equivalent to Spotify's complete Web API. Because of that, this integration can provide search, public playlists and supported embedded playback, but it cannot mirror every private YouTube Music feature such as the complete signed-in Music library, recommendations/history or all Music-specific likes.

The embedded player remains visible because YouTube requires embedded playback to use its supported player presentation and minimum player size.
