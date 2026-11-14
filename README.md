# ReelMind

A guessing-game-style movie picker. It asks you a few quick questions, then recommends a movie to watch.

There's no AI here. The questions are prewritten, and a hand-coded scoring algorithm picks the movie. Movie data is pulled live from [TMDB](https://www.themoviedb.org/).

## Running it

1. Get a free TMDB account and an **API Read Access Token** (Settings → API).
2. Create a file called `.env.local` in the project folder:
   ```
   VITE_TMDB_TOKEN=your-token-here
   ```
3. Install and start:
   ```
   npm install
   npm run dev
   ```

This product uses the TMDB API but is not endorsed or certified by TMDB.
