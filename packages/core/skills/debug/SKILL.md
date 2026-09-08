---
name: debug
description: 'Trace a failure to its cause and verify a focused fix.'
---

Establish the observed behavior, expected behavior and reproducible trigger. Read relevant code and available logs before choosing a cause. Distinguish evidence from hypotheses.
Trace the request or event across relevant boundaries. Test the smallest hypothesis that can explain the symptoms. Preserve unrelated changes and avoid speculative refactors.
If implementation is authorized, fix the cause and run a regression check that fails for the original behavior. Report the cause, change and verification. Do not expose secrets in diagnostics.
