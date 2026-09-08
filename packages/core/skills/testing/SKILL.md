---
name: testing
description: 'Choose focused checks for the behavior being changed.'
---

Identify the contract and user-visible behavior at risk. Inspect the project’s existing test tools and conventions before adding anything.
Prefer focused behavioral checks over implementation-mirroring tests. Cover the relevant successful flow, boundary conditions and meaningful failures, including authorization and retries where applicable.
Use isolated fixtures and avoid production mutations or paid services without authorization. Run appropriate checks, report actual results and limitations, and respect repository rules about where tests and temporary artifacts belong.
