## Foundation
- [x] F1-F6  Scaffold, rules, docs, env/provider config, cleanup (commit 81c5c91)

## Features
- [x] A1  Gnani STT server client + /api/transcribe (validation, mock, retry)
- [x] A2  extractHazard(): OpenRouter + mock + think-strip + zod + retry
- [x] A3  Voice recorder component: hold-to-record, client-side WAV 16kHz, 30s cap
- [x] B1  Delhi ward GeoJSON + Turf.js tagging
- [x] B2  Leaflet map dashboard
- [x] C1  Routing: bypass + hazmat
- [x] C2  Financial impact logging
- [x] D1  Prisma ORM schema (User, Report, Ward)
- [x] D2  Weekly audit job
- [x] G1  Demo wiring and seed data

## Decisions
- D-001 Leaflet + OSM   D-002 swappable LLM, mock default
- D-003 OpenRouter, non-reasoning for extraction, stronger model for audit

## Known risks
- Gnani 30s vs 60s limit conflict in docs -> cap at 30s
- No STT confidence score -> use transcript length/empty checks instead
- Evon hosted access unconfirmed (adapter later)

## Blocked / waiting on you
- OpenRouter key (for A2)
