# ReelMind

A guessing-game-style movie picker. It asks you a series of quick questions, then recommends a movie to watch.

There's no AI here. The questions are prewritten, and a hand-coded scoring algorithm picks the movie. Movie data is pulled live from [TMDB](https://www.themoviedb.org/). Movies only, no TV shows.

This is a personal hobby project. You can run it two ways:

- **On your own computer.** All you need is Node.js and a free TMDB account.
- **On a home server, next to [Seerr](https://github.com/seerr-team/seerr).** Anyone on your network can play. **Request it** sends the movie it picks to Seerr, which downloads it into Jellyfin.

Seerr is optional either way. Without it, everything works except **Request it**, which just doesn't appear.

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
- **Already seen it:** shows the next-best movie instead. If you're playing as a profile, it's saved, and that movie is never suggested to you again.
- **Profiles:** the switcher in the top right. Pick who's watching, or add a profile (just a name, no password). Open it to see your seen movies, and **Remove** any you marked by mistake. **Delete this profile** is at the bottom of that page (it asks first). **Guest** saves nothing. See [Profiles](#profiles).
- **Request it (only with Seerr):** after you accept a pick, it checks whether the movie is already on your server. If it is, it links to it in Jellyfin. If not, **Request it** sends it to Seerr, which has Radarr download it. If you're playing as a profile, the movie also goes on your list, tagged **Requested**, so it isn't suggested to you again.
- **Behind the scenes:** a panel under the game showing the current top 5, your taste profile and any filters. Handy for testing.
- Click **ReelMind** at the top to go back to the start.

## Setup

Everyone starts with [Step 1: Get a TMDB token](#step-1-get-a-tmdb-token). Then pick one:

| You want to… | Follow |
|---|---|
| Play on your own computer | [Option A: On your computer](#option-a-on-your-computer) |
| Run it on a home server so others can play, with or without Seerr | [Option B: On a home server (Docker)](#option-b-on-a-home-server-docker) |
| Try **Request it** from your computer before putting it on the server | Option A, then [Connecting Seerr](#connecting-seerr) |

### Step 1: Get a TMDB token

1. Make a free account on [themoviedb.org](https://www.themoviedb.org/signup).
2. Go to **Settings → API** ([direct link](https://www.themoviedb.org/settings/api)). If you don't have an API key yet, request one: choose **Developer**, accept the terms and fill in the short form. A personal project is fine.
3. Copy the **API Read Access Token**. It's the long one that starts with `eyJ`, not the shorter **API Key**.

The token stays on ReelMind's own small server (`server/api.js`). The page asks that server for TMDB data and the server adds the token, so it's never built into the page.

### Option A: On your computer

You need [Node.js](https://nodejs.org/) 20.19+ or 22.12+. The LTS version from nodejs.org is fine. To check which one you have, run `node -v`.

1. Get the code:
   ```
   git clone https://github.com/akhan328/ReelMind.git
   cd ReelMind
   ```
   No git? On the GitHub page, click **Code → Download ZIP**, unzip it, and open a terminal in that folder.
2. Make your settings file by copying `.env.example` to `.env.local`:
   - macOS, Linux or Git Bash: `cp .env.example .env.local`
   - Windows (Command Prompt or PowerShell): `copy .env.example .env.local`

   Open `.env.local` in a text editor and paste your token after `TMDB_TOKEN=`. Leave the Seerr lines empty unless you're [connecting Seerr](#connecting-seerr). `.env.local` is in `.gitignore`, so your token is never committed.
3. Install and start:
   ```
   npm install
   npm run dev
   ```
4. Open http://localhost:5173.

To stop it, press Ctrl+C in the terminal. If you change `.env.local`, restart `npm run dev`. Profiles are saved in `profiles.json` in the project folder.

**Playing from your phone or another device on your Wi-Fi:** run `npm run build`, then `npm start` instead of `npm run dev`. Then open `http://<your-computer's-ip>:4173` on the other device. Your firewall may ask you to allow Node.js.

> **Set up with an older version?** If your `.env.local` says `VITE_TMDB_TOKEN`, it still works. Renaming it to `TMDB_TOKEN` is better.

### Option B: On a home server (Docker)

The `Dockerfile` builds the app and runs its server on port 4173. The only thing it saves is `profiles.json`, in `/app/data` inside the container, so that folder needs a volume.

1. Clone this repo onto the server:
   ```
   git clone https://github.com/akhan328/ReelMind.git
   ```
2. Make a folder for the profiles, and let the container write to it. It runs as user 1000, Node's default user:
   ```
   mkdir -p /path/to/reelmind-data
   sudo chown 1000:1000 /path/to/reelmind-data
   ```
3. Using Seerr? Get its API key and check the requirements in [Connecting Seerr](#connecting-seerr).
4. In your compose file, add this under `services:`. If you use Seerr, use the compose file that has Seerr. Replace the placeholders.
   ```yaml
   reelmind:
     build: /path/to/ReelMind # where you cloned this repo
     container_name: reelmind
     init: true
     environment:
       - TMDB_TOKEN=your-tmdb-token
       - SEERR_URL=http://seerr:5055 # Seerr's container name and port
       - SEERR_API_KEY=your-seerr-api-key
     volumes:
       - /path/to/reelmind-data:/app/data # profiles.json is saved here
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
   - **Not using Seerr?** Leave out the `SEERR_URL` and `SEERR_API_KEY` lines and the `networks:` part.
   - To keep the keys out of the compose file, put the settings in a file and point to it with `env_file:`.
5. Start it:
   ```
   docker compose up -d --build reelmind
   ```
6. Check the log with `docker logs reelmind`. It should say:
   ```
   ReelMind is running on http://localhost:4173
     Seerr: http://seerr:5055
     Profiles: /app/data/profiles.json
   ```
   Without Seerr, the second line says `Seerr: not set up`. If it warns `Can't save profiles`, the data folder isn't writable (step 2).
7. Open `http://<server-ip>:4173` from any device on your network.

**Updating:** `git pull` in the repo folder, then `docker compose up -d --build reelmind` again. Profiles are kept, since they live in the data folder.

**Without Docker:** on the server, follow Option A's steps 1 and 2. Then run `npm install`, `npm run build` and `npm start`. It reads `.env.local`, listens on `PORT` (default 4173), and saves profiles to `PROFILES_FILE` (default: `profiles.json` in the project folder). `.env.example` lists every setting.

## Connecting Seerr

Seerr (formerly Jellyseerr) lets ReelMind request the movie it picks. This works with either setup option.

**Before you start:** Seerr has to be connected to Jellyfin and to Radarr already, with a Radarr server marked **Default Server** (Seerr: **Settings → Services**). That's where requests go.

**The two settings:**

| Setting | What to put |
|---|---|
| `SEERR_API_KEY` | In Seerr, go to **Settings → General** and copy the **API Key**. |
| `SEERR_URL` | The address ReelMind's server uses to reach Seerr. In Docker, on the same network as Seerr: `http://seerr:5055` (Seerr's container name and port). On your computer, or a server without Docker: `http://<server-ip>:5055`. |

Put them in the compose file's `environment:` (Option B) or in `.env.local` (Option A, or a server without Docker), then restart ReelMind. To check it worked, accept a pick: a Seerr box appears under **Enjoy [movie]!** On a server, the startup log also says `Seerr: http://...` rather than `Seerr: not set up`.

**What it shows** after **Sounds good!** or **This one!**:
- **Watch in Jellyfin** if the movie is already on the server.
- That it's downloading, or waiting for approval, if it's already been requested.
- **Request it** if it isn't there yet. If you're playing as a profile, the movie goes on your list once the request goes through, tagged **Requested**, and isn't suggested to you again. As **Guest**, nothing is saved.

Requests use Seerr's API key, so they count as your Seerr admin account and are approved right away. Seerr sends them to its default Radarr server with its default quality profile and root folder. Requests made while testing from your own computer are real requests too.

**Watch in Jellyfin** links to the address in Seerr's **Settings → Jellyfin → External URL**. Set that to the address people use to open Jellyfin, e.g. `http://<server-ip>:8096`. Otherwise the link may point to an address other devices can't open.

> **Keep it on your home network.** Anyone who can open the page can request movies, and the requests are approved as you. Don't port-forward it to the internet.

## Profiles

Profiles are saved in `profiles.json`. The app creates it when you add the first profile. On your computer it's in the project folder, and it's in `.gitignore`, so your lists stay off GitHub. In Docker it's `/app/data/profiles.json`, in the folder you mounted.

```json
{
  "profiles": [
    {
      "name": "Anan",
      "created": "2026-11-17T21:30:00.000Z",
      "seen": [
        { "id": 603, "title": "The Matrix", "year": 1999, "poster": "/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg", "seenAt": "2026-11-17T21:42:10.000Z" },
        { "id": 129, "title": "Spirited Away", "year": 2001, "poster": "/39wmItIWsg5sZMyRUHLkWBcuVCM.jpg", "requested": true, "seenAt": "2026-11-21T20:05:31.000Z" }
      ]
    }
  ]
}
```

- `id` is the TMDB movie id. It's the only field the app needs to skip a movie. The others are for the seen-movies screen.
- `"requested": true` means the movie was requested in Seerr rather than marked **Already seen it**. Either way, it isn't suggested again.
- You can edit the file by hand, for example to rename a profile. Do it while the app isn't running. If the file stops being valid JSON, the app says so and doesn't overwrite it.
- ReelMind's own server saves the file, so profiles work with `npm run dev`, `npm run preview`, `npm start` and Docker. A plain static copy of `dist/` has no profile switcher.
- Everyone who opens ReelMind sees the same profiles, so on a home server each person picks theirs once per device. The browser remembers which profile it played as last.

## Troubleshooting

| What you see | What to do |
|---|---|
| `'npm' is not recognized` or `npm: command not found` | Install [Node.js](https://nodejs.org/), then open a new terminal. |
| `Vite requires Node.js version 20.19+ or 22.12+` | Your Node.js is too old. Install the current LTS from nodejs.org. |
| "No TMDB token found" | `.env.local` must be in the project folder, next to `package.json`, and named exactly `.env.local`. Windows can hide a `.txt` on the end, so copying `.env.example` (Option A, step 2) is the safest way to make it. In Docker, set `TMDB_TOKEN` in the compose file. Restart after changing it. |
| "TMDB rejected the token" | You probably copied the short **API Key**. Use the long **API Read Access Token** instead. |
| No Seerr box after picking a movie | `SEERR_URL` or `SEERR_API_KEY` isn't set, or ReelMind wasn't restarted after setting them. On a server, the startup log says `Seerr: not set up`. |
| "Couldn't reach Seerr at …" | Check `SEERR_URL`. In Docker, ReelMind must be on the same network as Seerr, and the address uses Seerr's container name. From your computer, use the server's IP address. |
| "Seerr rejected the API key" | Copy the key again from Seerr's **Settings → General**. Regenerating it there makes the old one stop working. |
| "Seerr said: …" | Seerr refused the request (for example, the movie is on its blocklist). Seerr's logs have the details. |
| **Watch in Jellyfin** opens the wrong address | Set **External URL** in Seerr's **Settings → Jellyfin**. |
| "Couldn't read or save profiles.json", or the log says `Can't save profiles` | In Docker, the folder mounted at `/app/data` must be writable by user 1000: `sudo chown 1000:1000 /path/to/reelmind-data`. |
| "profiles.json isn't valid JSON" | Someone hand-edited it and broke it. Fix the file, or delete it to start over. |
| No profile switcher in the top right | You're opening a static copy of `dist/`. Use `npm run dev` or `npm start`, which include ReelMind's server. |

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the app locally, at http://localhost:5173 |
| `npm run build` | Build a production version into `dist/` |
| `npm start` | Serve the built app and its API, at port 4173 (run `npm run build` first) |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | Check the code with oxlint |

## Project layout

```
src/
  App.jsx               screens and game state
  gameFlow.js           runs one turn: apply the answer, pull more movies, load details
  useProfiles.js        who's playing, and their seen movies
  api/tmdb.js           all TMDB calls, request limiting, and the browser cache for details
  api/seerr.js          Seerr: is the movie on your server, and "Request it"
  api/profiles.js       reading and saving profiles
  engine/engine.js      the algorithm: scoring, picking questions, when to guess
  engine/traits.js      turns TMDB data into traits (genre, era, perception, themes...)
  data/questions.json   every question
  data/themes.json      themes and the TMDB keyword ids behind them
  components/           question screen, result screen, Seerr panel, profile switcher, seen movies,
                        behind-the-scenes panel
server/
  api.js                the /api routes: TMDB and Seerr, with the keys added server-side
  profiles.js           the /api/profiles routes: reads and writes profiles.json
  index.js              production server (npm start, Docker): the built app + the /api routes
```

The settings that control the algorithm (question limits, how picky it is, and so on) are at the top of `src/engine/engine.js`.

## Credits

This product uses the TMDB API but is not endorsed or certified by TMDB. Movie data and posters come from [themoviedb.org](https://www.themoviedb.org/).
