import fs from 'fs';
import path from 'path';

// Just a standalone test script that does validation and print (duplicates seed_reports logic for CLI)
const rawData = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'seed_raw.json'), 'utf-8'));

let dropped = 0;
const valid = [];

rawData.forEach(r => {
  if (typeof r.id === 'string' && typeof r.days_ago === 'number') {
    valid.push(r);
  } else {
    dropped++;
  }
});

const windows = [0, 0, 0, 0];
const cpWindows = [0, 0, 0, 0];
const kbWindows = [0, 0, 0, 0];

valid.forEach(r => {
  const weekIndex = Math.floor(r.days_ago / 7);
  if (weekIndex >= 0 && weekIndex < 4) {
    windows[weekIndex]++;
    
    const loc = r.raw_location.toLowerCase();
    if (loc.includes('connaught place') || loc.includes('cp block') || loc.includes('cp inner')) {
      cpWindows[weekIndex]++;
    }
    if (loc.includes('karol bagh')) {
      kbWindows[weekIndex]++;
    }
  }
});

console.log(`Dropped: ${dropped}`);
console.log("Verification Table (counts per 7-day window 0-3):");
console.log(`Overall: ${windows.join("/")} (Expected: 26/15/10/9)`);
console.log(`Connaught Place: ${cpWindows.join("/")} (Expected: 8/1/0/0)`);
console.log(`Karol Bagh: ${kbWindows.join("/")} (Expected: 6/4/2/1)`);
