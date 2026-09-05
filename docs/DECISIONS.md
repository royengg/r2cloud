# Decisions and remaining choices

Confirmed by the user on 5 September 2026. This record supersedes the preliminary questions in the recovered proposal.

| Area | Confirmed decision |
| --- | --- |
| Audience | Product teams and nontechnical founders/product managers. |
| Execution | Managed cloud sandboxes at launch. A connected runner is a future extension. |
| Product sign-in | GitHub only for now, through Better Auth. Repository GitHub App access and AI credentials remain separate. |
| Agent | Codex first, with a provider adapter boundary. |
| Permissions | Contributors start work. Designated project reviewers approve publication. Merge requires separate authorisation. Agents cannot approve either action. |
| Autonomy | Individually started tasks and explicitly authorised bounded batches; no unrestricted continuous picking. |
| Repository scope | Websites and web applications. |
| Completion | Coding tasks complete only after actual PR merge is verified. Production deployment is separate and out of scope. |
| Experience | Fresh light interface with soft blue/apricot/sage surfaces, rounded shapes, collapsible org/project sidebar, Hugeicons and Plus Jakarta Sans. Three board columns, scoped composer and progressively disclosed review details. Neumorphic buttons and restrained motion follow the latest references. |
| Workspace | `/home/paseo-agent/workspace/r2cloud`. Both session and VPS instructions explicitly permit this path. |

Reversible engineering choices: React/TypeScript/Vite, Express/TypeScript, Postgres, separate API/workflow/publisher processes, durable database jobs and events, immutable review manifests, authenticated preview grants, versioned run-pinned skills. The user subsequently selected Prisma for Neon Postgres, Socket.IO for realtime, and Bun workspaces/package manager/runtime. No Neon resource has been provisioned.

One unresolved change per repository is a configurable pilot policy (`repositories.max_changes`), not a permanent data-model restriction or separately confirmed product requirement. Organisation concurrency and per-run time/budget grants are independent limits.

Cloud BYOK remains a proposed authentication default. Managed cloud and Codex do not establish permission to share personal accounts, hosted-subscription entitlement, or a final billing arrangement. Product identity, repository installation, and provider delegation remain separate.

Open choices: sandbox vendor, infrastructure budget, expected concurrency, region/residency, production hosting, provider credential/billing arrangement, supported web stacks, and whether direct human code editing belongs in the launch scope.

## Recovery and implementation record

All four original documents were read and moved from the mistaken project directory without overwriting files. The target initially contained only an unborn Git repository. RESEARCH.md retains the earlier agent's source-review provenance; it is not a claim that this session repeated that review.

Local implementation uses clearly labelled fixtures for external execution and publication until approved accounts and vendor implementations exist. A fixture result never proves real cloud execution or GitHub publication. See [IMPLEMENTATION.md](IMPLEMENTATION.md) for the current boundaries and validation record.

The user clarified that incremental commits must remain local. Push all accumulated commits only after explicit final approval. Earlier commits were already pushed under the previous instruction. A temporary Cloudflare tunnel to the local fixture was subsequently authorised for UI review; paid provisioning and production deployment remain unauthorised.
