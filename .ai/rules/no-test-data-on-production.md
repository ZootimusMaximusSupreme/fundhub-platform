---
description: Test customer rows stay off production; role logins may be used for testing
alwaysApply: true
---

# Production test data and role logins

**Owner law (2026-10-20):** No test customer rows are left on production; tests run on scratch databases.

**Owner update (2026-10-27):** Agents may create, use, and keep the role logins needed to test Chris's assigned work on production. Verify that each needed role can sign in. This is standing authorization; do not ask Chris again for login creation.

A Full End-To-End Audit that Chris orders by name may make sim people on live while it runs. Remove those sim customer rows right after with the guarded delete (allowed since 2026-10-24).
