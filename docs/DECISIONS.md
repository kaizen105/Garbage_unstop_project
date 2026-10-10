# Decisions

- **D-001**: Leaflet + OSM (free, no token needed).
- **D-002**: Swappable LLM provider, mock default for easy local dev.
- **D-003**: OpenRouter; fast non-reasoning model for real-time extraction, stronger model for weekly audit; Evon adapter kept for later; strip `<think>` blocks, validate JSON.
- **D-004**: Routing - Standard truck planned route is demo depot (Karol Bagh) -> hazard -> transfer station (Okhla). Hazmat depots are CP and Dwarka. This is illustrative.
- **D-005**: Financial Impact - Assigned illustrative baseline damages and Detour cost metrics per km for routing bypass logic.
- **D-006**: MVP Database - MVP schema is defined in Prisma strictly for structure and modeling. No live DB is instantiated in production app to adhere to browser-only hackathon scope.
