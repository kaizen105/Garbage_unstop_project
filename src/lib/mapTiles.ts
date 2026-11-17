export interface MapTileConfig {
  url: string;
  subdomains: string;
  maxZoom: number;
  attribution: string;
  className: string;
}

export const OSM_DARK_TILE_CONFIG: MapTileConfig = {
  url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  subdomains: "abc",
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  className: "osm-dark-tiles",
};
