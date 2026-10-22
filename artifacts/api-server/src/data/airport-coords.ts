// Approximate lat/lon for network airports (IATA → [lat, lon]). Used to place
// markers on the ops weather radar. Rough airport-reference positions are fine.
export const AIRPORT_COORDS: Record<string, [number, number]> = {
  // Australia
  BNE: [-27.38, 153.12], OOL: [-28.16, 153.51], CNS: [-16.89, 145.75], TSV: [-19.25, 146.77],
  MCY: [-26.60, 153.09], PPP: [-20.49, 148.55], MKY: [-21.17, 149.18], ROK: [-23.38, 150.48], HVB: [-25.32, 152.88],
  SYD: [-33.95, 151.18], NTL: [-32.79, 151.83], BNK: [-28.83, 153.56], CBR: [-35.31, 149.20], WSI: [-33.88, 150.74],
  MEL: [-37.67, 144.84], AVV: [-38.04, 144.47], HBA: [-42.84, 147.51], LST: [-41.55, 147.21], ADL: [-34.95, 138.53],
  DRW: [-12.41, 130.87], AYQ: [-25.19, 130.98], PER: [-31.94, 115.97], BQB: [-33.69, 115.40],
  // New Zealand
  AKL: [-37.01, 174.79], WLG: [-41.33, 174.81], CHC: [-43.49, 172.53], ZQN: [-45.02, 168.74], DUD: [-45.93, 170.20], HLZ: [-37.87, 175.33],
  // Asia / Pacific
  DPS: [-8.75, 115.17], SIN: [1.36, 103.99], BKK: [13.69, 100.75], HKT: [8.11, 98.31], NRT: [35.76, 140.39], KIX: [34.43, 135.24],
  ICN: [37.46, 126.44], CMB: [7.18, 79.88], SGN: [10.82, 106.66], MNL: [14.51, 121.02], CEB: [10.31, 123.98],
  NAN: [-17.76, 177.44], RAR: [-21.20, -159.81], VLI: [-17.70, 168.32],
};
