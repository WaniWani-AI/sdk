# Security Policy

We take the security of `@waniwani/sdk` and the WaniWani Platform seriously. Thank you for helping keep our users safe.

## Supported versions

We ship from the latest `0.x` minor release. Security fixes are published to the most recent minor; older minors are not patched. Always upgrade to the latest version before reporting.

| Version | Supported |
| ------- | --------- |
| latest `0.x` | ✅ |
| older `0.x` | ❌ |

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report privately through either channel:

- **GitHub Security Advisories (preferred):** open a private report at
  [github.com/WaniWani-AI/sdk/security/advisories/new](https://github.com/WaniWani-AI/sdk/security/advisories/new).
  This keeps the disclosure private and lets us collaborate on a fix.
- **Email:** [security@waniwani.ai](mailto:security@waniwani.ai).

Please include:

- A description of the vulnerability and its impact.
- Steps to reproduce, or a proof of concept.
- Affected version(s) and environment.
- Any suggested remediation, if you have one.

## What to expect

- **Acknowledgement** within 3 business days.
- **Initial assessment** (severity and triage) within 7 business days.
- **Progress updates** as we work toward a fix, and credit in the release notes once a patch ships — unless you'd prefer to stay anonymous.

## Scope

In scope:

- The `@waniwani/sdk` npm package (the open-source flow engine and the hosted-tier client code in this repository).

Out of scope:

- Vulnerabilities in third-party dependencies — please report those upstream (we'll still want to know so we can pin or patch).
- Issues that require a compromised host, physical access, or a non-default, explicitly insecure configuration.
- Findings in the hosted Platform infrastructure (`app.waniwani.ai`) unrelated to this SDK — email [security@waniwani.ai](mailto:security@waniwani.ai) for those.

## Disclosure

We follow coordinated disclosure. We ask that you give us a reasonable window to ship a fix before any public disclosure, and we'll keep you in the loop on the timeline.
