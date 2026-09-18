# Security policy

## Reporting a vulnerability

Please report security issues privately through
[GitHub Security Advisories](https://github.com/philppplik/zwep/security/advisories/new)
rather than opening a public issue.

Include what you can of: the affected component, the steps to reproduce, the
impact you believe it has, and any proof of concept. You will get an
acknowledgement within a few days, and an assessment with a fix timeline once
the report is confirmed.

Please do not test against systems you do not own.

## Supported versions

Zwep is pre-1.0 and moves fast. Fixes land on `main`; only the latest release
receives security updates.

| Version | Supported |
| --- | --- |
| 0.2.x | Yes |
| < 0.2 | No |

## Security model

Zwep is designed to be run **on infrastructure you control**, for a search
index you curate. Understanding what that does and does not protect matters
before you expose it to a network.

### What Zwep protects

- **Query privacy.** Searches are answered from your own index. The web UI
  loads no third-party scripts, analytics or web fonts, so no outside party
  sees what you searched for.
- **Crawl politeness.** The crawler honours `robots.txt` and `crawl-delay`,
  identifies itself as `ZwepBot/1.0`, stays inside the configured
  `allowedDomains`, and caps fetch time and response size.
- **Injection at the boundaries.** Search filter values are quoted before they
  reach Meilisearch. Crawled content is escaped before it is rendered; the only
  markup allowed through from the index is the `<mark>` used for highlights.
- **Admin separation.** Every mutating endpoint requires an admin key, compared
  in constant time. The key travels in the `x-admin-key` header, so it does not
  land in browser history, referrers or proxy logs.

### What Zwep does not protect

- **There is no user model.** The admin key is a single shared secret, not an
  account system. Anyone holding it can reconfigure sources and start crawls.
- **The index is not access-controlled.** Any client that can reach the API can
  search everything in it. Put an authenticating reverse proxy in front if that
  is not acceptable.
- **The rate limiter is a safety belt, not a WAF.** It is in-process and
  per-instance, meant to stop a runaway client rather than a determined
  attacker. Use a real gateway on a public deployment.
- **Crawling is a trust decision.** A source you add can serve anything. Zwep
  escapes what it renders, but the content itself is only as trustworthy as the
  domains you allow.

## Deployment checklist

Before exposing Zwep beyond `localhost`:

1. **Change every default secret.** `ZWEP_ADMIN_KEY` and `MEILI_MASTER_KEY`
   ship with development defaults that are public in this repository.
2. **Keep the bind address tight.** `API_HOST` defaults to `127.0.0.1`. Only
   widen it if something else is terminating TLS in front.
3. **Set `API_CORS_ORIGINS` to your actual origin.** The `*` default is for
   development.
4. **Terminate TLS.** The admin key is a bearer credential; over plain HTTP it
   is readable in transit.
5. **Do not publish Meilisearch.** Port 7700 should be reachable only from the
   API.
6. **Leave `GOOGLE_PROXY_ENABLED=false`** unless you specifically want Zwep to
   send queries to Google on your behalf.
7. **Think before enabling a cloud LLM.** With `LLM_PROVIDER=openrouter`, search
   queries and result excerpts are sent to OpenRouter. `ollama` keeps everything
   local.

## Secrets and this repository

`.env` is gitignored; `.env.example` contains placeholders only. If you ever
commit a real key, rotate it — removing it from the working tree does not
remove it from the git history.
