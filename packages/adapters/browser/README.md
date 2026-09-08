# Sandbox browser runtime

Install this pinned bundle at `/opt/r2cloud/browser` while preparing the sandbox image, with lifecycle scripts disabled. Keep it root-owned and outside repository checkouts. It supplies Chromium and Playwright for isolated preview inspection; it does not run on the API host.

Create the unprivileged `r2-browser` user with its own home directory. As root, install the manifest with `npm install --ignore-scripts --no-audit --no-fund`, then extract Chromium with `VERCEL=1` so the Amazon Linux libraries are included. The runtime expects `/tmp/chromium` executable by `r2-browser`, libraries at `/tmp/al2023/lib` and fonts at `/tmp/fonts`. Keep these extracted files root-owned.

Browser preparation must verify that network namespaces work and that only the preview's loopback relay is reachable. Do not fall back to running an unrestricted browser on the API host.

Validate a screenshot under `r2-browser` in an isolated network namespace before creating the snapshot. Remove preparation fixtures and caches, and snapshot before adding any credentials or repository data. Rebuild before snapshot expiry. Chromium 149 is an external browser for Playwright 1.63; the combination has passed this project's inspection checks, but is not Playwright's bundled version.
