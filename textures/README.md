Place PNG / JPG / WebP / GIF skins here (flat filenames only, e.g. `frog.png`). After uploading, pick the skin in **Account** (same host as the game). The server lists files via `GET /api/textures`.

For production Docker deploys, add `COPY textures ./textures` in the root Dockerfile (or mount this folder) so images exist in the container.
