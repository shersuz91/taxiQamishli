# taxiQamishli

## Booking map configuration

The booking map uses public OpenStreetMap tiles, OSRM driving routes, and Nominatim reverse geocoding. No map API key is exposed in the browser.

Set these environment variables before deploying:

```powershell
$env:FLASK_SECRET_KEY = "replace-with-a-long-random-value"
$env:TELEGRAM_BOT_TOKEN = "your-telegram-bot-token"
$env:TELEGRAM_CHAT_ID = "your-telegram-chat-id"
$env:SESSION_COOKIE_SECURE = "true"
```

`FLASK_SECRET_KEY` must be set to a long, random, private value in production. Set `SESSION_COOKIE_SECURE` to `true` when the site is served through HTTPS.

## Telegram booking notifications

Telegram delivery is enabled only when both values are configured before the app starts:

```powershell
$env:TELEGRAM_BOT_TOKEN = "your-bot-token"
$env:TELEGRAM_CHAT_ID = "your-chat-id"
python main.py
```

Each accepted booking sends the customer details followed by a server-verified `ملخص الرحلة`: pickup, destination, driving distance, estimated time, estimated fare in `ل.س`, and both coordinate pairs.

`OSRM_BASE_URL` is optional and defaults to the public OSRM routing service. Set it to a managed or self-hosted OSRM service in production if traffic requires it. The Flask backend independently recalculates each submitted driving route and fare before storing it and sending the Telegram booking notification.

## First administrator account

The application uses `instance/taxi.db` by default. It creates the schema and default business settings on startup. The default service area is centered on Qamishli with a 100 km radius; change it in the dashboard before accepting live bookings.

Create exactly one initial administrator through environment variables. Choose a unique username and a password of at least 12 characters; never commit either password or secret key.

```powershell
$env:ADMIN_USERNAME = "your-admin-username"
$env:ADMIN_PASSWORD = "use-a-long-unique-password"
flask --app main create-admin
```

The command refuses to create a second administrator and stores only a secure password hash. Then visit `/admin/login` and sign in. Pricing, service area, online booking availability, and optional service hours are managed through `/admin/dashboard`.

There was no pre-existing database in this project. For a deployment that already has a database, introduce a migration process before changing models; `db.create_all()` creates missing tables but does not alter existing table schemas.