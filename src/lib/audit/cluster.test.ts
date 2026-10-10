import { describe, it, expect } from 'vitest';
import { findLargestAnomaly } from './cluster';
import { seedReports } from '../../data/seed_reports';
import { tagWard } from '../spatial/wards';

describe('findLargestAnomaly', () => {
  it('returns null if no anomalies >= 3 reports', () => {
    const res = findLargestAnomaly([{ ward_id: 'w1', hazard_category: 'c1', createdAt: new Date().toISOString() }]);
    expect(res).toBeNull();
  });

  it('finds largest anomaly', () => {
    const now = new Date();
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();
    
    const reports = [
      { ward_id: 'w1', hazard_category: 'chemical', createdAt: threeDaysAgo, lat: 10, lng: 20 },
      { ward_id: 'w1', hazard_category: 'chemical', createdAt: threeDaysAgo, lat: 10, lng: 20 },
      { ward_id: 'w1', hazard_category: 'chemical', createdAt: threeDaysAgo, lat: 10, lng: 20 }, // 3 this week
      { ward_id: 'w1', hazard_category: 'chemical', createdAt: tenDaysAgo } // 1 prev week
    ];
    const res = findLargestAnomaly(reports);
    expect(res).toEqual({
      ward: 'w1', category: 'chemical', this_week: 3, prev_week: 1, pct_increase: 200, centroid: { lat: 10, lng: 20 }
    });
  });

  it('with seeded data, the audit returns ward NDMC CHARGE 2, category construction_debris', () => {
    const auditReports = seedReports.map(r => {
      const tag = tagWard(r.coordinates);
      return {
        ward_id: tag.status === 'matched' ? tag.ward_name : undefined,
        hazard_category: r.hazard_category,
        createdAt: r.createdAt || new Date().toISOString(),
        lat: r.coordinates?.lat,
        lng: r.coordinates?.lng
      };
    });
    
    const res = findLargestAnomaly(auditReports);
    expect(res).toBeDefined();
    expect(res?.ward).toBe('NDMC CHARGE 2');
    expect(res?.category).toBe('construction_debris');
  });
});
