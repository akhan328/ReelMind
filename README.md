# ReelMind

A guessing-game-style movie picker. It asks you a series of quick questions, then recommends a movie to watch.

There's no AI here. The questions are prewritten, and a hand-coded scoring algorithm picks the movie. Movie data is pulled live from [TMDB](https://www.themoviedb.org/). Movies only, no TV shows.

This is a personal hobby project and isn't hosted anywhere. It runs on your own computer.

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
- **Behind the scenes:** a panel under the game showing the current top 5, your taste profile and any filters. Handy for testing.
- Click **ReelMind** at the top to go back to the start.

## Running it

You need [Node.js](https://nodejs.org/) 20.19+ or 22.12+ and a free TMDB account.

1. On themoviedb.org, go to **Settings → API** and copy your **API Read Access Token** (the long one, not the short API key).
2. Create a file called `.env.local` in the project folder:
   ```
   VITE_TMDB_TOKEN=your-token-here
   ```
   `.env.local` is in `.gitignore`, so the token is never committed.
3. Install and start:
   ```
   npm install
   npm run dev
   ```
4. Open the address it prints, usually http://localhost:5173.

If you change `.env.local` while the dev server is running, restart it.

> **Note:** don't deploy this as a public website with your token. Vite builds the token into the page's JavaScript, where anyone could read it.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the app locally |
| `npm run build` | Build a production version into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | Check the code with oxlint |

## Project layout

```
src/
  App.jsx               screens and game state
  gameFlow.js           runs one turn: apply the answer, pull more movies, load details
  api/tmdb.js           all TMDB calls, request limiting, and the browser cache for details
  engine/engine.js      the algorithm: scoring, picking questions, when to guess
  engine/traits.js      turns TMDB data into traits (genre, era, perception, themes...)
  data/questions.json   every question
  data/themes.json      themes and the TMDB keyword ids behind them
  components/           question screen, result screen, behind-the-scenes panel
```

The settings that control the algorithm (question limits, how picky it is, and so on) are at the top of `src/engine/engine.js`.

## Credits

This product uses the TMDB API but is not endorsed or certified by TMDB. Movie data and posters come from [themoviedb.org](https://www.themoviedb.org/).
