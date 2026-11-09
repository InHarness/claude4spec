# u10 — non-blocking findings (round 1)

- **rev-0001** `src/client/components/onboarding/typeSteps.tsx:32` — toKebabCase duplicates shared slugify without the ł→l mapping; KEBAB regex duplicates SKILL_NAME_RE.
