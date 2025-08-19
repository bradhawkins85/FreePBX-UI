# FreePBX UI

A lightweight React front‑end for managing a FreePBX 17 installation. It provides extension management, call log browsing, realtime queue/trunk status and an audit trail. The app ships with a mock mode so it can be explored without a live PBX.

## Development

### Prerequisites
- [Node.js](https://nodejs.org/) 18+
- npm

### Setup
```bash
npm install
npm run dev
```
This starts Vite's dev server on <http://localhost:5173>. Tailwind is loaded via CDN so no extra build steps are required.

### Build for production
```bash
npm run build
npm run preview   # serve the built assets from the dist/ folder
```

## Connecting to FreePBX
At the top of the interface there is a configuration card where you can enter:

- **API Base URL** – e.g. `https://pbx.example.com/admin/api`
- **API Key / Token** – a token generated from your FreePBX 17 system
- **ARI WebSocket URL** – optional realtime status feed
- **Use mock data** – enable this when you don't have access to a live FreePBX instance

The UI communicates with the FreePBX 17 REST API. Adjust the endpoints in `src/App.jsx` if your installation differs.

## Features
- Create, edit and delete extensions with optimistic updates
- Paginated CDR viewer with CSV export
- Realtime trunk and queue status (with mock fallback)
- Role based access (admin vs helpdesk)
- Simple audit log of user actions

## License
GPLv3. See [LICENSE](LICENSE).
