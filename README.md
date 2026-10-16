# Filtered Play for TidaLuna

A [TidaLuna](https://github.com/Inrixia/TidaLuna) plugin for the TIDAL desktop app. When you type into the filter box on a playlist or your Liked tracks, playing a track queues only the tracks that match the filter. Out of the box, TIDAL ignores the filter and queues the entire list.

**Example:** Open Liked tracks, filter for `Evidence`, and double-click one of his songs. TIDAL normally plays that song and then continues through every liked track. With Filtered Play, the queue holds only the Evidence tracks, starting from the one you picked.

## Features

- Works on playlists and Liked tracks (any track list with a filter box)
- Starts from the track you clicked and keeps the on-screen order
- Optionally applies to the **Play** and **Shuffle** buttons at the top of a filtered list
- Respects shuffle mode
- Blocks TIDAL from appending the rest of the playlist later as the queue runs low
- Clear the filter and TIDAL behaves exactly as before

## Install

1. Install [TidaLuna](https://github.com/Inrixia/TidaLuna#installation).
2. In TIDAL, open **Luna Settings** (top right) and go to **Plugin Store**.
3. Paste this into **Install from URL**:

   ```
   https://github.com/YOUR_GITHUB_USERNAME/tidaluna-filtered-play/releases/download/latest/store.json
   ```

4. Install **Filtered Play** from the store that appears.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| Play only filtered tracks | On | Master switch |
| Apply to Play and Shuffle buttons | On | The list's Play and Shuffle buttons also queue only the matches |
| Show notice | On | Shows "Playing N tracks matching ..." when the plugin builds the queue |
| Debug logging | Off | Logs detection details to the dev console (Ctrl+Shift+I / Cmd+Opt+I) |

## How it works

TIDAL keeps the filter text in the page's component state, not in its Redux store, so the plugin reads it from the page.

1. A capture-phase click listener records which track row or button you clicked.
2. The plugin intercepts TIDAL's `playQueue/ADD_TRACK_LIST_TO_PLAY_QUEUE` and `playQueue/ADD_NOW` actions. If the click was recent and the current list has text in its filter box, it cancels the original action.
3. It builds the matching track list from three sources:
   - track metadata in TIDAL's Redux store (title, version, artists, album; case and accent insensitive)
   - the full playlist from the TIDAL API when the playlist isn't fully loaded
   - the rows TIDAL actually rendered as matches
4. It orders the result to agree with the rows on screen, then dispatches `playQueue/ADD_NOW` with only those tracks.
5. While that queue is active, it blocks TIDAL's "load the rest of the list" actions for the same source.

If anything fails, the plugin re-dispatches TIDAL's original action, so playback never breaks.

## Reporting a bug

TIDAL updates can change page markup. If the plugin stops kicking in:

1. Turn on **Debug logging** in the plugin settings.
2. Open the dev console (Ctrl+Shift+I on Windows/Linux, Cmd+Opt+I on macOS).
3. Filter a list, play a track, and copy any `[FilteredPlay]` lines into an issue.

## Development

Requires Node.js and pnpm.

```bash
pnpm install
pnpm run watch
```

`watch` builds on change and serves `./dist` on port 3000. A **DEV** store appears under Luna Settings > Plugin Store for installing the dev build.

```bash
pnpm run build   # one-off build to ./dist
```

### Releases

Every push runs the GitHub Action, which builds the plugin and publishes it to the `latest` release. Before the first push, set **Settings > Actions > General > Workflow permissions** to **Read and write permissions** so the action can create the release.

## Credits

Built on [luna-template](https://github.com/Inrixia/luna-template) by Inrixia.

## License

AGPL-3.0, inherited from luna-template. See [LICENSE](LICENSE).
