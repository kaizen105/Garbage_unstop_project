import { rankHotspots } from "../src/lib/early-warning/trends";
import { seedReports } from "../src/data/seed_reports";

async function main() {
  const hotspots = rankHotspots(seedReports);
  console.log("Top 5 Hotspots:");
  hotspots.slice(0, 5).forEach((h, i) => {
    console.log(`${i+1}. ${h.ward} (near ${h.area_landmark || "none"}) - this_week: ${h.this_week}, risk: ${h.risk}, proj: ${h.projection}`);
  });
}

main().catch(console.error);
