export function findLargestAnomaly(reports: { ward_id?: string; hazard_category: string; createdAt: string; lat?: number; lng?: number }[]) {
  const now = new Date();
  const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;
  
  const thisWeek = reports.filter(r => new Date(r.createdAt).getTime() > now.getTime() - ONE_WEEK);
  const prevWeek = reports.filter(r => {
    const t = new Date(r.createdAt).getTime();
    return t <= now.getTime() - ONE_WEEK && t > now.getTime() - 2 * ONE_WEEK;
  });

  const countsThis = new Map<string, number>();
  const countsPrev = new Map<string, number>();
  
  for (const r of thisWeek) {
    if (!r.ward_id) continue;
    const key = `${r.ward_id}|${r.hazard_category}`;
    countsThis.set(key, (countsThis.get(key) || 0) + 1);
  }
  for (const r of prevWeek) {
    if (!r.ward_id) continue;
    const key = `${r.ward_id}|${r.hazard_category}`;
    countsPrev.set(key, (countsPrev.get(key) || 0) + 1);
  }

  let maxIncrease = -Infinity;
  let maxKey: string | null = null;
  let maxThis = 0;
  let maxPrev = 0;
  let maxPct = 0;

  for (const [key, countThis] of countsThis.entries()) {
    if (countThis >= 3) {
      const countPrev = countsPrev.get(key) || 0;
      const increase = countThis - countPrev;
      const pct_increase = countPrev === 0 ? Infinity : (countThis - countPrev) / countPrev;
      
      if (increase > maxIncrease || (increase === maxIncrease && countThis > maxThis)) {
        maxIncrease = increase;
        maxKey = key;
        maxThis = countThis;
        maxPrev = countPrev;
        maxPct = pct_increase;
      }
    }
  }

  if (!maxKey) return null;

  const parts = maxKey.split("|");
  const ward = parts[0];
  const category = parts[1] || "";
  
  const relevantReports = thisWeek.filter(r => r.ward_id === ward && r.hazard_category === category && r.lat && r.lng);
  let lat = 0, lng = 0;
  if (relevantReports.length > 0) {
    lat = relevantReports.reduce((sum, r) => sum + r.lat!, 0) / relevantReports.length;
    lng = relevantReports.reduce((sum, r) => sum + r.lng!, 0) / relevantReports.length;
  }

  return {
    ward,
    category,
    this_week: maxThis,
    prev_week: maxPrev,
    pct_increase: maxPct === Infinity ? 1000 : Math.round(maxPct * 100),
    centroid: relevantReports.length > 0 ? { lat, lng } : null
  };
}
