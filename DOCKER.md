# Docker Deployment

This application ships as two containers:

- `frontend`: static React files served by Nginx, with `/api` proxied to the backend.
- `backend`: Express + SQLite API server.

## Prerequisites

- Docker installed on your system
- Docker Compose

## Run with Published Images

GitHub Actions builds and pushes images to GitHub Container Registry when code is pushed to `main`, `master`, or a `v*` tag.

```bash
docker compose -f docker-compose.prod.yml up -d

# The application will be available at:
# http://localhost:8080
```

Default image names:

- `ghcr.io/wosa1402/githubstarsmanager-frontend:latest`
- `ghcr.io/wosa1402/githubstarsmanager-backend:latest`

For a fork or a custom tag, set environment variables before starting:

```bash
GHCR_OWNER=your-github-name \
GHCR_REPO=githubstarsmanager \
IMAGE_TAG=latest \
docker compose -f docker-compose.prod.yml up -d
```

## Build Locally

Use the local compose file when you want to build images on the machine where the app is deployed:

```bash
docker compose up -d --build
```

## Configuration

Create a `.env` file for production:

```bash
cp .env.example .env
```

Then set stable secrets:

```bash
API_SECRET=change-me
ENCRYPTION_KEY=$(openssl rand -hex 32)
```

`ENCRYPTION_KEY` must be 64 hex characters. Do not change it after storing AI, GitHub, or WebDAV credentials, or existing encrypted values will no longer decrypt.

The production compose file stores backend data on the host:

```text
./data/backend:/app/data
```

Back up this directory before migrations or major upgrades.

## GitHub Container Registry

The workflow is located at:

```text
.github/workflows/docker-images.yml
```

It builds both images for:

- `linux/amd64`
- `linux/arm64`

Pull requests only build images for validation. Pushes to branches and tags also publish them to GHCR.

## Stop

```bash
docker compose -f docker-compose.prod.yml down
```

## Note on Desktop Packaging

This Docker setup does not affect the existing desktop packaging workflow.
