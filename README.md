# FreePBX UI

A lightweight React front‑end for managing a FreePBX 17 installation. It provides extension management, call log browsing, realtime queue/trunk status and an audit trail. The app ships with a mock mode so it can be explored without a live PBX.

## Installation

The repository includes an `install.sh` script that provisions everything needed to run the UI on Ubuntu 24.04.
Run it as root (or via `sudo`) from the project directory:

```bash
sudo bash install.sh
```

The script will install Node.js 18, PM2, and FreePBX/Asterisk (if missing), then fetch the UI
dependencies and start the development server under PM2 on port `5137`.
After it completes, visit `http://<server-ip>:5137` in your browser.

## Development

### Prerequisites
- [Node.js](https://nodejs.org/) 18+
- npm

### Setup
```bash
npm install
npm run dev
```
This starts Vite's dev server on `http://0.0.0.0:5137`, making it accessible from other machines at `http://<server-ip>:5137`. Tailwind is loaded via CDN so no extra build steps are required.

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

## 📱 Popular Free Softphone Apps

### Cross-Platform (Android + iOS)

- **Zoiper** (free version)
  - One of the most popular SIP clients.
  - Works with FreePBX using SIP or PJSIP extensions.
  - Free version supports voice calls; paid version adds push notifications, video, and extra codecs.
- **Linphone** (open source, free)
  - 100% free and open source.
  - Supports voice, video, messaging, and even encrypted calls.
  - Works with SIP extensions out-of-the-box.
- **Groundwire / Acrobits Softphone**
  - Paid, but worth noting. Acrobits Softphone has a limited free trial.
  - More advanced than Zoiper/Linphone, with excellent push support.

### Android

- **CSipSimple** (open source)
  - Once very popular, but development has slowed. Still works reliably on many Android devices.
- **MizuDroid SIP VoIP Softphone**
  - Free, lightweight, and supports multiple SIP accounts.

### iOS

- **Zoiper Lite (iOS)** – Free basic SIP client, easy setup with QR provisioning (if configured in FreePBX).
- **Linphone (iOS)** – Free, open-source, with push notifications supported via Linphone’s SIP service.

### 🔧 How They Connect to FreePBX

1. Create an Extension in FreePBX (SIP or PJSIP).
2. Set a username, password, and transport (UDP/TCP/TLS).
3. On your app, add a new SIP account with:
   - **Server / Domain:** your FreePBX server’s public IP or domain
   - **Username:** the extension number (e.g. 1001)
   - **Password:** the SIP secret for that extension
4. Make sure ports are open:
   - **SIP:** 5060/UDP (and/or 5061/TCP/TLS)
   - **RTP:** 10000–20000/UDP
5. For mobile use: strongly consider TLS + SRTP and the FreePBX firewall to protect against SIP attacks.

### ⚠️ Notes on Push Notifications

- FreePBX itself doesn’t provide native push.
- Apps like Linphone and Zoiper Premium offer their own push services (Zoiper free does not).
- If push isn’t used, the app must stay running in the background to receive calls.

### ✅ Best “free + stable” choices today

- **Linphone** (open source, cross-platform, free, supports encryption).
- **Zoiper Free** (simpler UI, but limited features without paid upgrade).

## Features
- Create, edit and delete extensions with optimistic updates
- Paginated CDR viewer with CSV export
- Realtime trunk and queue status (with mock fallback)
- Role based access (admin vs helpdesk)
- Simple audit log of user actions

## License
GPLv3. See [LICENSE](LICENSE).
