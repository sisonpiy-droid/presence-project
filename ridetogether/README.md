# RideTogether

Live map for a group ride (3 bikes, 6 people). Static site + free Supabase + OpenStreetMap. No build step, no paid APIs.

## Try it now (no setup)

```bash
cd ridetogether
npx serve .        # or: python -m http.server 8000
```

Open the URL and tap **Try demo mode**. Three fake bikes ride a real road route to a destination with live distances and ETAs; you are Bike 1.

## Setup for the real trip (about 10 minutes)

**1. Supabase (free)**
1. Create a project at supabase.com.
2. SQL Editor → paste all of `supabase.sql` → Run.
3. Project Settings → API → copy the **Project URL** and the **anon public key** into `config.js`.

**2. Host it over HTTPS** (phones only allow GPS on HTTPS, so `localhost` is not enough). Easiest options:
- **Netlify Drop**: go to app.netlify.com/drop and drag the `ridetogether` folder in. You get a link immediately.
- **Vercel**: `cd ridetogether && npx vercel --prod`.
- GitHub Pages also works.

**3. Run the trip**
1. One person opens the link → **Create a trip** → search or tap the destination → **Create trip**.
2. They enter their name and pick their bike, then tap **Invite** and send the link (or the 5-letter code) to the group chat.
3. Everyone else opens the link, enters their name and picks a bike (max 2 people per bike).
4. On **one phone per bike**, tap **📡 Share GPS** and allow location. Keep that screen on.

## Using it on the road

- **Tracker phone** (one per bike, usually the pillion's): after joining, tap **Yes, share this bike's location**. The phone switches to a black tracker screen (saves battery on OLED) that shows the bike, "Sharing · sent 3s ago", the ETA to the destination, and the other bikes ("6.6 km · 9 min ahead of you"). Keep the screen on and the phone on a power bank. Tap **Show map** for the map.
- **Navigation phone** (the rider's): use **Navigate to Destination** / **Navigate to Bike**, which open Google Maps in two-wheeler mode with voice directions. A web page stops sharing GPS when its screen is off or another app is in front, which is why the tracker and navigation phones are separate.
- **Alerts:** a red banner (and a buzz on Android) appears when a bike is more than 3 km from yours or loses signal for 45 s. Change `GAP_ALERT_M` in `app.js` to tune it.
- Reloaded or closed the tab? Open the link again: GPS sharing resumes by itself, and the home page has a **Resume trip** button.

## Good to know

- Anyone with the trip code can see the trip, and the database is open to anyone with the anon key. Fine for one trip; delete the Supabase project afterwards.
- ETAs come from the free public OSRM server (car speeds). If it's unreachable, numbers are shown with `~` and are straight-line estimates. Map tiles are OpenStreetMap's free server (fine for a small group).
- Same name on a new phone = rejoin as the same rider.
- `node test.mjs` checks the distance/format helpers.
