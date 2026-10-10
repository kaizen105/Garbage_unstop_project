import { tagWard } from "../lib/spatial/wards";

const data = [
  {
    report_id: "HZ-8001", hazard_category: "biohazard_medical", severity_level: 9, 
    raw_location: "Karol Bagh Metro Station", coordinates: { lat: 28.6448, lng: 77.1891 }, action_required: "dispatch_hazmat_bypass_standard"
  },
  {
    report_id: "HZ-8002", hazard_category: "construction_debris", severity_level: 7, 
    raw_location: "Connaught Place Block A", coordinates: { lat: 28.6315, lng: 77.2167 }, action_required: "bypass_standard"
  },
  {
    report_id: "HZ-8003", hazard_category: "electrical_hazard", severity_level: 5, 
    raw_location: "Lajpat Nagar Market", coordinates: { lat: 28.5677, lng: 77.2433 }, action_required: "routine_collection"
  },
  {
    report_id: "HZ-8004", hazard_category: "chemical", severity_level: 10, 
    raw_location: "Okhla Industrial Estate", coordinates: { lat: 28.5524, lng: 77.2790 }, action_required: "dispatch_hazmat_bypass_standard"
  },
  {
    report_id: "HZ-8005", hazard_category: "general_overflow", severity_level: 4, 
    raw_location: "Saket PVR", coordinates: { lat: 28.5245, lng: 77.2066 }, action_required: "routine_collection"
  },
  {
    report_id: "HZ-8006", hazard_category: "construction_debris", severity_level: 8, 
    raw_location: "Nehru Place", coordinates: { lat: 28.5494, lng: 77.2523 }, action_required: "bypass_standard"
  },
  {
    report_id: "HZ-8007", hazard_category: "biohazard_medical", severity_level: 6, 
    raw_location: "Janakpuri District Center", coordinates: { lat: 28.6219, lng: 77.0878 }, action_required: "dispatch_hazmat_bypass_standard"
  },
  {
    report_id: "HZ-8008", hazard_category: "general_overflow", severity_level: 8, 
    raw_location: "Chandni Chowk", coordinates: { lat: 28.6505, lng: 77.2303 }, action_required: "bypass_standard"
  }
];

export default data.map(d => ({
  ...d,
  ward: tagWard(d.coordinates)
}));
