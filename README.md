# Trip Planner

**Collaborative travel itinerary management — plan trips, share with friends, and navigate in real time.**

[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript)](https://www.typescriptlang.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-06B6D4?logo=tailwindcss)](https://tailwindcss.com)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL%20%2B%20Realtime-3ECF8E?logo=supabase)](https://supabase.com)
[![PWA](https://img.shields.io/badge/PWA-ready-5A0FC8?logo=pwa)](https://web.dev/progressive-web-apps)

---

## Features

- **📅 Itinerary Management** — Create trips with date ranges, add/edit/delete places per day with notes, drag-and-drop reordering, and dynamic day management.
- **🗺️ Interactive Map** — Google Maps markers with route polylines, tap-to-focus place cards showing address, visit time, and notes. Tap any POI for a quick card with a Google Maps deep link.
- **🚌 Directions** — Transit, taxi, and walking travel times shown simultaneously. Tap a mode to render the route polyline via the Routes API. Shows line names, stop counts, and transfer details. Geolocation-aware distances and a direct Google Maps directions link.
- **📥 Google Takeout Import** — Import saved places from a Google Takeout CSV, distribute them across days interactively, auto-resolve coordinates via the Places API, and skip duplicates.
- **🤝 Real-time Collaboration** — Google OAuth, shareable invite links, and live sync powered by Supabase Realtime. All itinerary changes propagate instantly to every member.
- **📱 Mobile / PWA** — Installable as a PWA (home screen, standalone mode). Handles safe areas (notch / Dynamic Island), `visualViewport` keyboard shifts, and skeleton loading screens.

---

## Getting Started

### Prerequisites

- Node.js 20+
- A [Supabase](https://supabase.com) project
- A [Google Cloud](https://console.cloud.google.com) project with the following APIs enabled:
  - Maps JavaScript API
  - Places API
  - Routes API

### Installation

```bash
git clone https://github.com/knulps/trip.git
cd trip
npm install
```

### Setup

1. Copy the example environment file and fill in your credentials:

   ```bash
   cp .env.local.example .env.local
   ```

2. Apply the database schema from `supabase/schema.sql` in your Supabase SQL editor (see [Database](#database)).

3. Start the development server:

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000).

---

## Configuration

All configuration is done via environment variables.

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous (public) key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-side only) |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Google Maps API key (Maps JS + Places, client-side) |
| `GOOGLE_MAPS_SERVER_KEY` | Google Maps API key for Routes API (server-side only) |

---

## Database

Hosted on Supabase (PostgreSQL). Row-Level Security (RLS) restricts all data access to trip members only.

| Table | Purpose |
|---|---|
| `trips` | Trip metadata (title, start/end dates, owner) |
| `days` | Individual days belonging to a trip |
| `places` | Places per day (name, coordinates, address, visit time, notes) |
| `trip_members` | Members of each trip (used for RLS and invite management) |

---

## Project Structure

```
app/
├── layout.tsx                  # Root layout, fonts, PWA meta
├── page.tsx                    # Home / trip list
├── globals.css                 # Tailwind base styles
├── manifest.ts                 # PWA manifest
├── login/                      # Google OAuth login page
├── auth/callback/              # OAuth callback handler
├── trip/
│   ├── new/                    # Create new trip
│   ├── add/                    # Add places flow
│   └── [id]/
│       ├── TripView.tsx        # Main trip view (map + list)
│       ├── PlaceList.tsx       # Day-by-day place list with DnD
│       ├── EditPlaceModal.tsx  # Edit place details
│       ├── DistanceBadge.tsx   # Transit/taxi/walk distance badge
│       └── import/             # Google Takeout CSV import UI
├── invite/[token]/             # Invite link handler
└── api/
    ├── distance/               # Server route: travel time via Routes API
    ├── route/                  # Server route: polyline for a travel mode
    └── resolve-place/          # Server route: place → coordinates (Places API)

lib/
├── supabase/
│   ├── client.ts               # Browser Supabase client
│   └── server.ts               # Server Supabase client (cookies)
types/
└── supabase.ts                 # Generated Supabase types

public/
├── icon.svg                    # App icon
└── sw.js                       # Service worker (PWA)
```

---

## Scripts

```bash
npm run dev      # Start development server (http://localhost:3000)
npm run build    # Production build
npm run start    # Start production server
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | [Next.js 16](https://nextjs.org) (App Router) |
| UI | [React 19](https://react.dev) + [TypeScript](https://www.typescriptlang.org) |
| Styling | [Tailwind CSS v4](https://tailwindcss.com) |
| Database / Auth | [Supabase](https://supabase.com) (PostgreSQL + Auth + Realtime) |
| Maps | [Google Maps Platform](https://developers.google.com/maps) (Maps JS, Places, Routes) |
| Drag & Drop | [dnd-kit](https://dndkit.com) |
| PWA | Service Worker + Web App Manifest |

---

## License

MIT
