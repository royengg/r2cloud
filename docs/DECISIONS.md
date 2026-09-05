# Decisions and remaining choices

Confirmed by the user on 5 September 2026. This record supersedes the preliminary questions in the recovered proposal.

| Area | Confirmed decision |
| --- | --- |
| Audience | Product teams and nontechnical founders/product managers. |
| Execution | Managed cloud sandboxes at launch. A connected runner is a future extension. |
| Agent | Codex first, with a provider adapter boundary. |
| Permissions | Contributors start work. Designated project reviewers approve publication. Merge requires separate authorisation. Agents cannot approve either action. |
| Autonomy | Individually started tasks and explicitly authorised bounded batches; no unrestricted continuous picking. |
| Repository scope | Websites and web applications. |
| Completion | Coding tasks complete only after actual PR merge is verified. Production deployment is separate and out of scope. |
| Experience | Dark, approachable three-column board; technical detail is progressively disclosed. |
| Workspace | `/home/paseo-agent/workspace/r2cloud`. Both session and VPS instructions explicitly permit this path. |

Reversible engineering choices: React/TypeScript/Vite, Express/TypeScript, Postgres, separate API/workflow/publisher processes, durable database jobs and events, immutable review manifests, authenticated preview grants, versioned run-pinned skills. Neon is a possible deployment vendor, not a commitment.

One unresolved change per repository is a configurable pilot policy (`repositories.max_changes`), not a permanent data-model restriction or separately confirmed product requirement. Organisation concurrency and per-run time/budget grants are independent limits.

Cloud BYOK remains a proposed authentication default. Managed cloud and Codex do not establish permission to share personal accounts, hosted-subscription entitlement, or a final billing arrangement. Product identity, repository installation, and provider delegation remain separate.

Open choices: sandbox vendor, infrastructure budget, expected concurrency, region/residency, production hosting, provider credential/billing arrangement, supported web stacks, and whether direct human code editing belongs in the launch scope.

## Recovery and implementation record

All four original documents were read and moved from the mistaken project directory without overwriting files. The target initially contained only an unborn Git repository. RESEARCH.md retains the earlier agent's source-review provenance; it is not a claim that this session repeated that review.

Local implementation uses clearly labelled fixtures for external execution and publication until approved accounts and vendor implementations exist. A fixture result never proves real cloud execution or GitHub publication. See [IMPLEMENTATION.md](IMPLEMENTATION.md) for the current boundaries and validation record.
