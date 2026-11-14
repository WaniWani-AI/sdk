---
"@waniwani/sdk": patch
---

Add `email.verify(address)`: it checks that an address a user typed can receive mail, and returns `valid`, `invalid`, `risky` or `unknown` with a reason and, for a domain typo such as `gmial.com`, a corrected address. Nothing to change in existing code.
