import fs from 'fs';
import path from 'path';
import * as turf from '@turf/turf';

const inputPath = path.resolve('data/raw/delhi_wards.geojson');
const outputPath = path.resolve('src/data/delhi_wards.json');

let raw;
try {
  raw = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
} catch (err) {
  console.error("Failed to read raw file, generating DEMO data");
  // DEMO Fallback
  const demoZones = [
    { name: "Karol Bagh", center: [77.1891, 28.6448] },
    { name: "Connaught Place", center: [77.2167, 28.6315] },
    { name: "Chandni Chowk", center: [77.2303, 28.6505] },
    { name: "Lajpat Nagar", center: [77.2433, 28.5677] },
    { name: "Saket", center: [77.2066, 28.5245] },
    { name: "Dwarka", center: [77.0583, 28.5523] },
    { name: "Rohini", center: [77.1130, 28.7366] },
    { name: "Nehru Place", center: [77.2523, 28.5494] },
    { name: "Okhla", center: [77.2790, 28.5524] },
    { name: "Laxmi Nagar", center: [77.2773, 28.6304] },
    { name: "Janakpuri", center: [77.0878, 28.6219] },
    { name: "Mayur Vihar", center: [77.2963, 28.6046] }
  ];

  const features = demoZones.map((zone, i) => {
    // 0.02 deg ~ 2km radius circle roughly
    const poly = turf.circle(zone.center, 2, { steps: 10, units: 'kilometers' });
    poly.properties = {
      ward_id: `DEMO-${i+1}`,
      ward_name: `DEMO ZONE - ${zone.name}`
    };
    return poly;
  });

  const finalGeoJSON = { type: 'FeatureCollection', demo_boundaries: true, features };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(finalGeoJSON));
  console.log(`Generated ${demoZones.length} demo zones.`);
  process.exit(0);
}

let wardCount = 0;
const features = [];

for (const feature of raw.features) {
  if (feature.geometry && (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon')) {
    const props = feature.properties || {};
    
    // Find case-insensitive keys
    const keys = Object.keys(props);
    const idKey = keys.find(k => k.toLowerCase().includes('ward_id') || k.toLowerCase().includes('ward_no') || k.toLowerCase() === 'id') || 'objectid';
    const nameKey = keys.find(k => k.toLowerCase().includes('ward_name') || k.toLowerCase().includes('ward_n') || k.toLowerCase() === 'name') || 'ward_name';
    
    const ward_id = props[idKey] != null ? props[idKey].toString() : wardCount.toString();
    const ward_name = props[nameKey] != null ? props[nameKey].toString() : `Ward ${wardCount}`;
    
    // Simplify
    const simplified = turf.simplify(feature, { tolerance: 0.0005, highQuality: false });
    
    // Round to 5 decimals
    turf.coordEach(simplified, (coord) => {
      coord[0] = Math.round(coord[0] * 100000) / 100000;
      coord[1] = Math.round(coord[1] * 100000) / 100000;
    });

    simplified.properties = { ward_id, ward_name };
    features.push(simplified);
    wardCount++;
  }
}

const finalGeoJSON = { type: 'FeatureCollection', features };

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
const outputStr = JSON.stringify(finalGeoJSON);
fs.writeFileSync(outputPath, outputStr);

console.log(`Processed ${wardCount} wards.`);
console.log(`File size: ${(outputStr.length / 1024 / 1024).toFixed(2)} MB`);
