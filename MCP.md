# MCP

No MCP (Model Context Protocol) servers are configured specifically for this repository today.

## Adding one later

If working on the backend (`server/`) becomes a frequent task, a MySQL-aware MCP server pointed at the local dev database (`server/.env.example`'s `DATABASE_URL`, or the `docker-compose.yml` MySQL container) would let Claude Code query/inspect data directly during development instead of going through `mysql`/`prisma studio` manually. That's the only project-specific MCP use case identified so far — nothing else in this repo (a client-side SPA plus a small Express API) currently has an MCP integration point.
