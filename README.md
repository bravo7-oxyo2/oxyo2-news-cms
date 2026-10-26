# Paperleaf CMS

A lightweight personal headless CMS with a React/Vite admin, Fastify API, PostgreSQL/Prisma, Markdown and WYSIWYG editing, and streamed filesystem media uploads.

## Local development

Requirements: Node.js 22+, pnpm 11+, and PostgreSQL 15+.

```bash
cp .env.example .env
# Edit DATABASE_URL, SESSION_SECRET, ADMIN_EMAIL, and ADMIN_PASSWORD.
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Admin: `http://localhost:5173`. Public news site: `http://localhost:5174`. API: `http://localhost:4000`. API docs: `http://localhost:4000/docs`.

The editor uses one Markdown document as its canonical value. Toast UI provides visual and Markdown modes; the API renders and sanitizes HTML. Posts include news metadata: category, stable `categoryId`, author, source label, featured flag, thumbnail, and SEO title/description. Public endpoints are `/api/v1/posts`, `/api/v1/posts/:slug`, `/api/v1/pages`, and `/api/v1/pages/:slug`; posts support `category`, `categoryId`, `featured`, `search`, `tag`, `page`, and `limit` query parameters.

## Public news website

The visitor-facing magazine site lives in `apps/news`. It is a separate React/Vite app that reads directly from the CMS public API and renders only published posts/pages.

- Homepage: hero story, must-read rail, featured cards, latest grid, visual categories, and static newsletter CTA.
- Article route: `/article/:slug`.
- Category route: `/category/:category`.
- Search route: `/search?q=keyword`.
- CMS page route: `/page/:slug`.

Mark posts as featured in the CMS admin to control the homepage hero/featured sections. Categories are managed from the CMS Categories admin page, stored in the `Category` table, linked to posts by `categoryId`, and exposed at `/api/v1/categories`; the news navigation renders from that API. The post editor uses the same category list and includes a searchable thumbnail picker/uploader backed by the media library.

The news app writes route-level SEO from CMS metadata: canonical URLs, robots directives, Open Graph/Twitter tags, social images, semantic headings, lazy/eager image loading, and JSON-LD structured data for the site, articles, and CMS pages. The API also serves crawler-friendly `/sitemap.xml`, `/rss.xml`, and `/robots.txt` for the news domain. Static browser assets live in `apps/news/public`.

To populate local demo news content with demo thumbnails:

```bash
pnpm --filter @cms/database seed:news
```

The demo news seed uses remote Unsplash image URLs for thumbnails and in-article media so the public site looks like a real magazine without requiring local image downloads. It also upserts the comprehensive `/page/about-this-cms` About page with SEO title/description fields. Unsplash images are free to use under the Unsplash license; attribution is appreciated but not required.

## Google Search Console insights

The private CMS admin includes **Search Insights** at `/search-insights`. It reads live Search Console performance, sitemap, and priority URL-inspection data, displays it in the admin, and exports the active date range as an AI-ready JSON file. It does not save analytics data to PostgreSQL.

Search Insights is available in both development and production. Create a **Web application** OAuth client in Google Cloud, enable the Google Search Console API, and register this redirect URI:

```text
https://YOUR_CMS_ADMIN_DOMAIN/api/admin/search-console/oauth/callback
```

For local development, register `http://localhost:5173/api/admin/search-console/oauth/callback`. For production, register the HTTPS callback under `ADMIN_ORIGIN`, for example `https://admin.thepaperleaf.com/api/admin/search-console/oauth/callback`. Add the Web client's ID and secret to the API environment along with a unique `GSC_TOKEN_ENCRYPTION_KEY`; set `GSC_TOKEN_STORE_PATH` to a private, server-only file outside the repository. The CMS requests only the `webmasters.readonly` scope. A CMS administrator can then connect an account with Search Console access and select the ThePaperLeaf property. Never add the OAuth JSON, client secret, encrypted connection file, or export data to Git.

The daily Codex automation, rather than the CMS web page, retrieves its fresh AI context from `GET /api/admin/search-console/automation-export`. The endpoint is available in production only over HTTPS, requires a dedicated `GSC_AUTOMATION_EXPORT_TOKEN` (at least 32 characters) in the `Authorization: Bearer <token>` header, disables response caching, and is limited to 10 requests per source IP per day. It returns `404` when the token is absent or invalid so the private integration is not advertised. Generate the production token with `openssl rand -base64 48`, store it only in the API environment and the Codex Cloud secret store, and never put it in a URL or browser bundle.

The automation should atomically replace the ignored `analysis/search-insights-current.json`, validate that the export has `schemaVersion: "1.0"`, and then invoke the installed `thepaperleaf-gsc-optimizer` skill in its own Codex environment. The active CMS checkout remains untouched unless the skill’s safe-fix and PR checks independently pass. Never add the token, exported context, raw queries, or generated private artifacts to Git.

## EC2 deployment

1. Launch Ubuntu on EC2, attach enough EBS storage for PostgreSQL plus uploads, assign a static IP/domain, and restrict ports with a security group (SSH from trusted IPs; HTTP/HTTPS publicly).
2. Run `deploy/bootstrap-ubuntu.sh` on the host. Create the database:

   ```sql
   CREATE USER cms WITH ENCRYPTED PASSWORD 'a-long-random-password';
   CREATE DATABASE cms OWNER cms;
   ```

3. Create `/home/ubuntu/apps/cms/.env.production` from `.env.production.example`, then replace all `REPLACE_ME` values and protect the file:

   ```bash
   cd /home/ubuntu/apps/cms
   cp .env.production.example .env.production
   chmod 600 .env.production
   ```

   Set `PUBLIC_BASE_URL` to the public news HTTPS origin, `ADMIN_ORIGIN` to the CMS admin HTTPS origin, and `UPLOAD_DIR=/home/ubuntu/apps/cms/shared/uploads`. To use Search Insights in production, also set `GSC_OAUTH_CLIENT_ID`, `GSC_OAUTH_CLIENT_SECRET`, `GSC_TOKEN_ENCRYPTION_KEY`, and the private `GSC_TOKEN_STORE_PATH`; the OAuth callback defaults to `${ADMIN_ORIGIN}/api/admin/search-console/oauth/callback`. Set `GSC_AUTOMATION_EXPORT_TOKEN` only when the protected server-to-server automation export is required. `DEEPSEEK_API_KEY` is required before production news-bot processing can run; use `DEEPSEEK_API_URL=https://api.deepseek.com` and `DEEPSEEK_MODEL=deepseek-chat`. Add stock provider keys only for the providers you intend to use; the fallback order is Pexels, Pixabay, Unsplash, then the built-in non-AI fallback. This file is never synchronized.
4. Replace `CMS_ADMIN_DOMAIN` and `NEWS_DOMAIN` in `deploy/nginx.conf`, copy it to `/etc/nginx/sites-available/cms`, enable it, test with `sudo nginx -t`, and reload Nginx.
5. Configure HTTPS with Certbot (`sudo apt install certbot python3-certbot-nginx && sudo certbot --nginx -d admin-domain -d news-domain`). Secure cookies require HTTPS in production.
6. Seed once on the server: `set -a; source .env.production; set +a; pnpm db:seed`.
7. Deploy from the workstation:

   ```bash
   CMS_HOST=ubuntu@your-host CMS_KEY="$HOME/.ssh/key.pem" ./deploy-rsync.sh
   ```

The script syncs source without secrets/uploads, installs locked dependencies, applies migrations, validates the production configuration, builds both apps, and starts/reloads both the API and the dedicated news-bot worker in PM2 only after success. It checks each process has a live PID, prints their PM2 status, and then verifies API readiness. A failed pre-reload build or configuration check leaves the healthy process untouched. For an application rollback, check out the prior revision locally and redeploy; database migrations must remain forward-compatible.

`deploy/bootstrap-ubuntu.sh` configures PM2 startup persistence. If the server was bootstrapped before this update, run the following once so the API and worker resume after a host reboot:

```bash
pm2 startup systemd -u ubuntu --hp /home/ubuntu
# Run the sudo command printed by PM2, then:
pm2 save
```

## Operations

- Health: `/health`; database readiness: `/ready`; logs: `pm2 logs cms-api` and `pm2 logs cms-news-bot-worker`.
- Monitor space with `df -h` and PostgreSQL/uploads with `du -sh /var/lib/postgresql /home/ubuntu/apps/cms/shared/uploads`. Configure CloudWatch alarms before production use.
- Media URLs are immutable. Nginx supports byte ranges for video and serves media without consuming API memory.
- Uploads are streamed with a 500 MB limit. Supported types: JPEG, PNG, GIF, WebP, MP4, WebM, and MOV.
- If `pnpm dev` inside `apps/api` says `tsx: command not found`, run `pnpm install` from the repository root first. The API package declares `tsx` as a dependency so `pnpm dev` can resolve it from `apps/api/node_modules/.bin`.

## Manual backups (important)

Automated backups are intentionally not configured. The app, PostgreSQL, and media share one EC2 failure domain; instance loss can therefore destroy all content.

```bash
pg_dump --format=custom --file="$HOME/cms-$(date +%F).dump" cms
tar -czf "$HOME/cms-media-$(date +%F).tar.gz" /home/ubuntu/apps/cms/shared/uploads
```

Copy both files off-instance and periodically test restoration. Restore PostgreSQL with `pg_restore --clean --if-exists --dbname=cms backup.dump` and extract media back into the configured upload directory.

## Security notes

Passwords use Argon2. Sessions are HTTP-only, secure in production, same-site, regenerated at login, and protected with CSRF tokens. Login/reset endpoints are rate limited. Content HTML is sanitized. Rotate `SESSION_SECRET`, database credentials, and the admin password through the server environment, never Git.
