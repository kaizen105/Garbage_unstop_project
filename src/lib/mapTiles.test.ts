import { describe, it, expect } from "vitest";
import { OSM_DARK_TILE_CONFIG } from "./mapTiles";

describe("OSM Dark Tile Configuration", () => {
  it("uses OpenStreetMap standard tiles and does not reference CARTO", () => {
    expect(OSM_DARK_TILE_CONFIG.url).toContain("tile.openstreetmap.org");
    expect(OSM_DARK_TILE_CONFIG.url).not.toContain("cartocdn");
    expect(OSM_DARK_TILE_CONFIG.attribution).toContain("OpenStreetMap");
    expect(OSM_DARK_TILE_CONFIG.attribution).not.toContain("CARTO");
  });

  it("specifies correct subdomains, zoom, and dark tile class", () => {
    expect(OSM_DARK_TILE_CONFIG.subdomains).toBe("abc");
    expect(OSM_DARK_TILE_CONFIG.maxZoom).toBe(19);
    expect(OSM_DARK_TILE_CONFIG.className).toBe("osm-dark-tiles");
  });
});
