# Sanitation and Fallbacks
- Validate every Gnani payload BEFORE sending (Audio: type/size/duration; Text: length/charset).
- Wrap EVERY external call in a try/catch with timeout.
- Turf.js failure -> set ward status to "unmapped", DO NOT crash.
- Empty map data -> render empty state fallback.
- NEVER log API keys or raw audio content.
