# Rasta Faisalabad

A public map of Faisalabad where anyone can report two kinds of problems without logging in:

- **Road closures**, which disappear from the map on their own after a set time: digging (Orange Line, pipes, cables), rain water, containers or protests, heavy traffic, accidents.
- **Broken things**, which stay on the map until people confirm they were fixed: potholes, open or overflowing gutters, street lights that are out, garbage.

Each report shows how many days it has been open. People can vote "mera bhi yahi masla hai", "theek ho gaya" or "abhi bhi toota hai". If a report of the same kind already exists within 80 m, the app points you to it so you vote there instead of filing a new one.

## Structure

- `docs/`: the website (plain HTML, CSS and JS, no build step), served by GitHub Pages from this folder
- `docs/config.js`: the Supabase URL and anon key. Both are public; the RLS rules are what protect the data.
- `supabase/schema.sql`: tables, RLS rules, a limit of 10 reports per hour, the photo storage bucket, and the view that counts votes
- `supabase/002_places.sql`: places that people add themselves (markets and plazas missing from OpenStreetMap) so search can find them
- `artifact/`: the first prototype, which ran as a claude.ai artifact

## Setup

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the SQL Editor, then `supabase/002_places.sql`.
3. Enable anonymous sign-ins under Authentication → Sign In / Providers.
4. Copy the Project URL and the anon (publishable) key into `docs/config.js`.
5. Turn on GitHub Pages under Settings → Pages: Branch `main`, folder `/docs`.

Road data: © OpenStreetMap contributors. The Orange Line highlight uses the roads named in news reports that OSM has names for, so it is an estimate.
