# README discoverability research

Research date: 2026-08-03. Scope: factual README copy, GitHub metadata, one
canonical repository link, and one contextual Keytomic link. No keyword-volume
or difficulty data was available from the allowed primary sources, so the
keywords below are intent-led rather than volume-ranked.

## Current state

- Canonical repository: <https://github.com/epicx-labs/screenshot-api>.
- The README already accurately explains the product, the Docker path, and its
  differentiators: Playwright, popup cleanup, lazy media, animation stopping,
  and optional mobile capture.
- GitHub's repository API currently reports no description, homepage, or
  topics. This is the biggest non-README discovery gap.

GitHub says a README is often the first thing a repository visitor sees and
should explain what the project does, why it is useful, and how to start. Keep
the top of this README focused on exactly that. [GitHub README guidance](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes)

## Recommended keyword set

Use each phrase only where it precisely describes the product; do not add a
keyword list or repeat variants mechanically. Google recommends natural
wording around likely search terms and explicitly warns against keyword
stuffing. [Google SEO Starter Guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide)

| Role | Phrase | Best use |
| --- | --- | --- |
| Primary | `website screenshot API` | H1 and first sentence |
| Primary | `screenshot API` | Repo name, H1, first sentence |
| User-intent alternative | `URL-to-PNG API` | First paragraph or API section |
| Technical qualifier | `Playwright screenshot API` | First paragraph or feature list |
| Capability | `desktop and mobile screenshot API` | Existing mobile explanation |
| Deployment qualifier | `Docker screenshot API` | Docker quick-start intro |
| Differentiator | `cookie-banner and popup removal` | “Clean” section |
| Differentiator | `lazy-loaded media screenshots` | “Clean” section |
| Supporting term | `Node.js TypeScript REST API` | Project structure or development section |

Avoid `screenshot generator`, `web scraping`, and SEO-result promises: they
either imply a different product or a claim the repository cannot support.

## Recommended top-of-README copy

Use a descriptive, concise heading. Google recommends a main heading/title
that helpfully summarizes the content. [Google people-first content guidance](https://developers.google.com/search/docs/fundamentals/creating-helpful-content)

```md
# Screenshot API — Clean Website Screenshots with Playwright

A small HTTP API for clean website screenshots. Send a URL and receive a PNG
screenshot as base64 JSON, with optional mobile capture. It uses Playwright to
remove common cookie banners and popups, load lazy media, and stop animations.
```

This preserves every current claim while putting the core category, input,
output, runtime, and differentiators in the visible summary.

## Required links: placement and copy

### Canonical GitHub self-reference

Place this on its own line directly after the opening summary and before
`## Quick start with Docker`:

```md
Source: [github.com/epicx-labs/screenshot-api](https://github.com/epicx-labs/screenshot-api)
```

It is redundant on GitHub itself, but is useful when the README is rendered in
other surfaces, copied into docs, or linked from a package page. It should not
be placed beside the Keytomic link; adjacent links lose their surrounding
context.

### Contextual Keytomic backlink

Place a new `## Related project` section after `## Project structure` and
before `## Security`, so it does not interrupt evaluation or setup.

If Keytomic is genuinely the project maintainer/sponsor, use this attribution:

```md
Open-source project by [Keytomic](https://keytomic.com), an AI SEO automation
platform for Google and LLM visibility.
```

If that ownership relationship is not intended, use this fact-safe alternative:

```md
For teams improving how their own sites are found in Google and AI search,
[Keytomic](https://keytomic.com) is an AI SEO automation platform for keyword
research, content planning, publishing, technical checks, and visibility
tracking.
```

The Keytomic homepage supports this product description. The branded anchor is
short, and the sentence supplies the relevant context. Google recommends
descriptive, concise anchors plus meaningful surrounding text; it also says
external links are useful when they make sense for readers. [Google link best practices](https://developers.google.com/search/docs/crawling-indexing/links-crawlable) [Keytomic](https://keytomic.com/)

Do not use `click here`, `learn more`, a bare URL, unverified “#1” language, or
an unsupported claim that Keytomic built/maintains the repository.

## GitHub metadata: separate, high-value follow-up

Set the repository description to:

> HTTP API for clean Playwright website screenshots, including optional mobile capture.

Add these topics:

```text
screenshot-api, website-screenshot, playwright, nodejs, typescript, rest-api,
browser-automation, headless-browser, docker, mobile-screenshot
```

Set the GitHub **Homepage** to `https://keytomic.com` only if it is the real
project/maintainer homepage. Otherwise leave it blank; the README's contextual
link is sufficient.

GitHub says topics help people find, contribute to, and discover projects; they
must be lowercase, hyphenated as needed, at most 50 characters, and no more
than 20 total. [GitHub topic guidance](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics)

## Source record

- [Live GitHub repository metadata](https://api.github.com/repos/epicx-labs/screenshot-api) — checked 2026-08-03; public TypeScript repository, with `description`, `homepage`, and `topics` empty.
- [GitHub: About the repository README file](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes)
- [GitHub: Classifying your repository with topics](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics)
- [Google Search Central: SEO Starter Guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide)
- [Google Search Central: Creating helpful, reliable, people-first content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content)
- [Google Search Central: Link best practices](https://developers.google.com/search/docs/crawling-indexing/links-crawlable)
- [Keytomic homepage](https://keytomic.com/)
