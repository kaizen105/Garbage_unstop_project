# Data Model

The data model is currently defined in `prisma/schema.prisma` for documentation and validation purposes only.
For this MVP hackathon demo, there is **NO live database**. All state (reports, map configurations) is stored ephemerally in the browser's `localStorage`.

## Schema Entities

- **User**: Represents fleet drivers, dispatchers, and admins.
- **Ward**: Represents spatial boundaries mapping to the Delhi MCD wards.
- **Report**: Represents field anomaly reports generated via voice input.
- **AuditRun**: Represents the AI-generated weekly root cause analysis for specific wards.
