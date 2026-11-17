# ReelMind

A guessing-game-style movie picker. It asks you a series of quick questions, then recommends a movie to watch.

There's no AI here. The questions are prewritten, and a hand-coded scoring algorithm picks the movie. Movie data is pulled live from [TMDB](https://www.themoviedb.org/). Movies only, no TV shows.

This is a personal hobby project. It runs on your own computer, or on a home server next to [Seerr](https://github.com/seerr-team/seerr) so people can request the movie it picks (see below).

## How it works

1. **Start:** it pulls about 200 movies from TMDB, a mix of well-known movies, popular-right-now movies and hidden gems. The mix is random, so every game is different.
2. **Questions:** you answer with **Yes**, **No**, **Don't know**, **Probably** or **Probably not**.
3. **Scoring:** every answer adds to a taste profile (genres, mood, era, length, age rating, how the public sees the movie, themes like "heist" or "time travel"). Every movie is scored against that profile.
4. **Choosing the next question:** it asks whatever best splits the movies at the top of the ranking. Questions go from broad ("animated?") to narrow ("found-footage horror?"). Narrow follow-ups only come up after a Yes to their parent question, so "zombies?" only gets asked after "Do you want to be scared?".
5. **Pulling more movies:** a Yes to something specific (a genre, theme, decade or language) pulls more matching movies from TMDB. For the top contenders it also loads keywords, runtime and age rating.
6. **The pick:** usually after 7 to 15 questions, it shows its pick with the poster, rating, runtime, a summary, why it was picked, and a few runner-ups.

## Features

- **Stop and show my pick:** after your first answer, skip straight to a recommendation.
- **Keep narrowing it down:** from the result screen, answer a few more questions to refine the pick.
- **Already seen it:** shows the next-best movie instead.
- **Request it (optional, with Seerr):** after you accept a pick, it checks whether the movie is already on your server. If it is, it links to it in Jellyfin. If not, **Request it** sends it to Seerr, which has Radarr download it.
- **Behind the scenes:** a panel under the game showing the current top 5, your taste profile and any filters. Handy for testing.
- Click **ReelMind** at the top to go back to the start.

## Running it

You need [Node.js](https://nodejs.org/) 20.19+ or 22.12+ and a free TMDB account. (To run it in Docker instead, see [Running it on a home server](#running-it-on-a-home-server-docker). The container brings its own Node.js.)

### 1. Get a TMDB token

1. Make a free account on [themoviedb.org](https://www.themoviedb.org/signup).
2. Go to **Settings → API** ([direct link](https://www.themoviedb.org/settings/api)). If you don't have an API key yet, request one: choose **Developer**, accept the terms and fill in the short form. A personal project is fine.
3. Copy the **API Read Access Token**. It's the long one that starts with `eyJ`, not the shorter **API Key**.

### 2. Start it

1. Create a file called `.env.local` in the project folder (`.env.example` lists every setting):
   ```
   TMDB_TOKEN=your-token-here
   ```
   `.env.local` is in `.gitignore`, so the token is never committed. (The old name, `VITE_TMDB_TOKEN`, still works.)
2. Install and start:
   ```
   npm install
   npm run dev
   ```
3. Open the address it prints, usually http://localhost:5173.

If you change `.env.local` while the dev server is running, restart it.

The token stays on the server. The page asks ReelMind's own small server (`server/api.js`) for TMDB data, and the server adds the token, so it's never built into the page's JavaScript.

## Requesting movies with Seerr

If you run [Seerr](https://github.com/seerr-team/seerr) (formerly Jellyseerr), ReelMind can request the movie it picks. It's optional: without these settings, ReelMind works as before.

Seerr needs to be connected to Jellyfin and to Radarr already, with a Radarr server marked **Default Server** (Seerr: **Settings → Services**). That's where requests go.

1. In Seerr, go to **Settings → General** and copy the **API Key**.
2. Add these to `.env.local`, or to the container's environment if you use Docker:
   ```
   SEERR_URL=http://seerr:5055
   SEERR_API_KEY=your-seerr-api-key
   ```
   `SEERR_URL` is the address ReelMind's server uses to reach Seerr:
   - ReelMind in Docker, on the same network as Seerr: `http://seerr:5055` (Seerr's container name and port).
   - ReelMind on another computer, e.g. `npm run dev` on your PC: `http://<server-ip>:5055`.
3. Restart ReelMind. On a server, the startup log says `Seerr: http://seerr:5055` when it's set up, or `Seerr: not set up` when it isn't. For Docker, view it with `docker logs reelmind`.

After **Sounds good!** or **This one!**, the screen shows one of these:
- **Watch in Jellyfin** if the movie is already on the server.
- That it's downloading, or waiting for approval, if it's already been requested.
- **Request it** if it isn't there yet.

Requests use Seerr's API key, so they count as your Seerr admin account and are approved right away. Seerr sends them to its default Radarr server with its default quality profile and root folder. Requests made while testing from your own PC are real requests too.

**Watch in Jellyfin** links to the address in Seerr's **Settings → Jellyfin → External URL**. Set that to the address people use to open Jellyfin, e.g. `http://<server-ip>:8096`. Otherwise the link may point to an address other devices can't open.

> **Keep it on your home network.** Anyone who can open the page can request movies, and the requests are approved as you. Don't port-forward it to the internet.

## Running it on a home server (Docker)

The `Dockerfile` builds the app and runs its server on port 4173. It keeps nothing on disk, so it needs no volume.

1. Clone this repo onto the server:
   ```
   git clone https://github.com/akhan328/ReelMind.git
   ```
2. In the compose file that has Seerr, add this under `services:`. Replace the placeholders with your TMDB token and Seerr API key. To keep the keys out of the compose file, you can put the three settings in a file and point to it with `env_file:`.
   ```yaml
   reelmind:
     build: /path/to/ReelMind # where you cloned this repo
     container_name: reelmind
     init: true
     environment:
       - TMDB_TOKEN=your-tmdb-token
       - SEERR_URL=http://seerr:5055 # Seerr's container name and port
       - SEERR_API_KEY=your-seerr-api-key
     ports:
       - 4173:4173
     networks:
       - media-network # the network Seerr is on
     healthcheck:
       test: wget --no-verbose --tries=1 --spider http://localhost:4173/ || exit 1
       start_period: 10s
       timeout: 3s
       interval: 30s
       retries: 3
     restart: unless-stopped
   ```
3. Run `docker compose up -d --build reelmind`, then open `http://<server-ip>:4173` from any device on your network.

To update later: `git pull` in the repo folder, then `docker compose up -d --build reelmind` again.

Without Docker: `npm install`, `npm run build`, then `npm start`. It reads `.env.local` and listens on `PORT` (default 4173).

## Troubleshooting

| What you see | What to do |
|---|---|
| "No TMDB token found" | Set `TMDB_TOKEN` in `.env.local` (or the container's environment) and restart. |
| "TMDB rejected the token" | You probably copied the short **API Key**. Use the long **API Read Access Token** instead. |
| No Seerr box after picking a movie | `SEERR_URL` or `SEERR_API_KEY` isn't set. The startup log says `Seerr: not set up`. |
| "Couldn't reach Seerr at …" | Check `SEERR_URL`. In Docker, ReelMind must be on the same network as Seerr, and the address uses Seerr's container name. |
| "Seerr rejected the API key" | Copy the key again from Seerr's **Settings → General**. Regenerating it there makes the old one stop working. |
| "Seerr said: …" | Seerr refused the request (for example, the movie is on its blocklist). Seerr's logs have the details. |
| **Watch in Jellyfin** opens the wrong address | Set **External URL** in Seerr's **Settings → Jellyfin**. |

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the app locally |
| `npm run build` | Build a production version into `dist/` |
| `npm start` | Serve the built app and its API (for a home server) |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | Check the code with oxlint |

## Project layout

```
src/
  App.jsx               screens and game state
  gameFlow.js           runs one turn: apply the answer, pull more movies, load details
  api/tmdb.js           all TMDB calls, request limiting, and the browser cache for details
  api/seerr.js          Seerr: is the movie on your server, and "Request it"
  engine/engine.js      the algorithm: scoring, picking questions, when to guess
  engine/traits.js      turns TMDB data into traits (genre, era, perception, themes...)
  data/questions.json   every question
  data/themes.json      themes and the TMDB keyword ids behind them
  components/           question screen, result screen, Seerr panel, behind-the-scenes panel
server/
  api.js                the /api routes: TMDB and Seerr, with the keys added server-side
  index.js              production server: the built app + the /api routes
```

The settings that control the algorithm (question limits, how picky it is, and so on) are at the top of `src/engine/engine.js`.

## Credits

This product uses the TMDB API but is not endorsed or certified by TMDB. Movie data and posters come from [themoviedb.org](https://www.themoviedb.org/).
