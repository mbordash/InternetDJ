# InternetDJ

InternetDJ is a full-stack music collaboration app with:

- a Node/Express backend in `backend/`
- a React frontend in `frontend/`
- a MariaDB schema in `database/schema.sql`
- Fly.io deployment examples in `fly.example.toml` and `database/fly.example.toml`

Live demo: [https://InternetDJ.co](https://InternetDJ.co)


## License note

If you want to release this project under GPL, add a `LICENSE` file for the exact GPL version you want to use (for example GPL-3.0-only or GPL-3.0-or-later) before publishing.

## Local development

### 1) Install dependencies

```zsh
cd backend && npm install
cd ../frontend && npm install
```

### 2) Create local env files

Copy the example files and fill in your own values:

```zsh
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

### 3) Run the app

Backend:

```zsh
cd backend
node server.js
```

Frontend:

```zsh
cd frontend
npm start
```

## Required environment variables

### Backend

See `backend/.env.example` for the full list. The main variables are:

- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASS`
- `PORT`
- `SESSION_SECRET`
- `JWT_SECRET`
- `FRONTEND_URL`, `FRONTEND_URL_LOCAL`, `FRONTEND_URL_PROD`, `CLIENT_URL`
- `API_BASE_URL` or `GOOGLE_CALLBACK_URL`
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3`, `AWS_REGION`, `BUCKET_NAME`, `PUBLIC_BUCKET_URL`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`
- `RECAPTCHA_SECRET_KEY`
- `REDIS_URL`
- `REPLICATE_API_TOKEN`

### Frontend

See `frontend/.env.example`:

- `REACT_APP_API_URL`
- `REACT_APP_SOLANA_RPC_URL`
- `REACT_APP_RECAPTCHA_SITE_KEY`

## Deploying on your own Fly account

This repo includes example Fly configs instead of account-specific production configs.

### 1) Create your Fly apps

Create two Fly apps in your own account:

- one for the web app
- one for MariaDB

Then copy and customize the example configs:

```zsh
cp fly.example.toml fly.toml
cp database/fly.example.toml database/fly.toml
```

Update at least these values:

- `app` in `fly.toml`
- `app` in `database/fly.toml`
- any domain-specific env values you want to use

### 2) Provision MariaDB

The database image uses:

- `database/dockerfile`
- `database/schema.sql`
- `database/my.cnf`

Set your database secrets on the DB app before deploy, including a strong `MARIADB_ROOT_PASSWORD`.

Example shape:

```zsh
fly secrets set MARIADB_ROOT_PASSWORD=replace-me -a your-app-db
```

Then deploy the database app from `database/`.

### 3) Provision object storage

This app expects an S3-compatible bucket for music, images, and stems.

Set these values for your own bucket:

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_ENDPOINT_URL_S3`
- `AWS_REGION`
- `BUCKET_NAME`
- `PUBLIC_BUCKET_URL`

`PUBLIC_BUCKET_URL` should be the public base URL for your bucket, for example:

```text
https://your-bucket-name.fly.storage.tigris.dev
```

### 4) Set app secrets

Set backend secrets on your web app. Minimum example:

```zsh
fly secrets set \
  NODE_ENV=production \
  PORT=5000 \
  DB_HOST=your-app-db.internal \
  DB_PORT=3306 \
  DB_NAME=internetdj \
  DB_USER=internetdj \
  DB_PASS=replace-me \
  SESSION_SECRET=replace-me \
  JWT_SECRET=replace-me \
  FRONTEND_URL=https://your-app-name.fly.dev \
  FRONTEND_URL_LOCAL=http://localhost:3000 \
  FRONTEND_URL_PROD=https://your-app-name.fly.dev \
  CLIENT_URL=https://your-app-name.fly.dev \
  PRIMARY_DOMAIN=https://your-app-name.fly.dev \
  PRIMARY_APP_HOST=your-app-name.fly.dev \
  API_BASE_URL=https://your-app-name.fly.dev/api \
  REACT_APP_API_URL=/api \
  AWS_ACCESS_KEY_ID=replace-me \
  AWS_SECRET_ACCESS_KEY=replace-me \
  AWS_ENDPOINT_URL_S3=https://fly.storage.tigris.dev \
  AWS_REGION=auto \
  BUCKET_NAME=your-bucket-name \
  PUBLIC_BUCKET_URL=https://your-bucket-name.fly.storage.tigris.dev \
  REDIS_URL=redis://replace-me \
  FFMPEG_CONCURRENCY_LIMIT=1 \
  -a your-app-name
```

### 5) Configure optional integrations

These features need extra setup if you want them enabled:

- Google login: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`
- email flows: `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`
- captcha: `RECAPTCHA_SECRET_KEY`, `REACT_APP_RECAPTCHA_SITE_KEY`
- AI stems worker: `REPLICATE_API_TOKEN`
- Solana features: `REACT_APP_SOLANA_RPC_URL`

### 6) Deploy the web app

Deploy from the repository root after secrets are set.

If you use Fly Machines or process scaling for the worker/cron entries, configure that in your Fly app after the initial deploy.

## Known deployment gotchas

- This repo previously contained hardcoded `internetdj.co` and bucket host assumptions in several runtime paths. The backend paths used for uploads, auth, proxying, sockets, and Fly config examples now use environment-based settings.
- The frontend still contains some hardcoded SEO/canonical URLs in individual page components. Those do not expose credentials, but you should update them if you want a fully rebranded deployment on a different domain.
- Review submission uses parameterized SQL in `backend/routes/reviews.js`; the slash issue reported by a tester is more consistent with an error-handling/schema problem than SQL injection. Raw SQL errors should never be shown to end users.

## Security checklist for publishing

- [ ] rotate all previously used production secrets
- [ ] verify `.README-private`, `backend/.env`, and `frontend/.env` are not committed
- [ ] check git history for old secrets
- [ ] add your GPL license file
- [ ] replace any remaining domain-specific branding you do not want public
