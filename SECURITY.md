# Security Policy

## Secrets

Never commit HarnessRouter API keys, third-party tokens, `.env` files, or generated session ownership data. Use `.env.example` for variable names with empty values.

If a credential is accidentally exposed, revoke it immediately before rewriting Git history.

## Reporting a vulnerability

Please report security issues privately to the HarnessRouter maintainers through GitHub's private vulnerability reporting feature. Do not open a public issue containing exploit details or credentials.
