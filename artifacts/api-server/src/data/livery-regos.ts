// Aircraft registrations taken from the hub's livery list (the real tails the
// VA flies, per the add-ons in flight-timetable/src/data/liveries.ts), grouped
// by fleet type. Seeded into the fleet so the schedule uses these tails. A rego
// appears under only one type (first match wins).
export const LIVERY_REGOS: Record<string, string[]> = {
  A320: [
    "VH-X3H", "VH-X3J", "VH-X3L", "VH-X3N",
    "VH-VFY",
    "VH-XNJ", "VH-XSJ", "VH-YXQ", "VH-YXS", "VH-YXT", "VH-YXU", "VH-YXV", "VH-YXW",
    "VH-VQG", "VH-VQH", "VH-VQK", "VH-VQL", "VH-VQM",
    "VH-VGF",
  ],
  A20N: [
    "VH-A5A", "VH-A5B", "VH-A5C", "VH-A5D", "VH-A5E", "VH-A5F",
  ],
  A21N: [
    "VH-OFP", "VH-OFW", "VH-OFL", "VH-OFE",
  ],
  B788: [
    "VH-VKD", "VH-VKF", "VH-VKJ",
  ],
};

// Reserve aircraft parked on the ground across the network (one per entry).
// Held out of the daily rotation and available at that airport for same-airport
// swaps. Bases are IATA codes (matching the flights). Assigned to tails
// deterministically at startup (lowest free registration of the type).
export const RESERVE_PLAN: Array<{ base: string; type: string }> = [
  // Main hubs: a narrowbody + a widebody on the ground.
  { base: "SYD", type: "A320" }, { base: "SYD", type: "B788" },
  { base: "MEL", type: "A320" }, { base: "MEL", type: "B788" },
  { base: "BNE", type: "A320" }, { base: "BNE", type: "B788" },
  { base: "PER", type: "A21N" }, { base: "PER", type: "B788" },
  // Major ports: a narrowbody each.
  { base: "ADL", type: "A320" },
  { base: "OOL", type: "A320" },
  { base: "CNS", type: "A20N" },
  { base: "HBA", type: "A320" },
  { base: "CBR", type: "A320" },
  { base: "DRW", type: "A21N" },
  { base: "TSV", type: "A320" },
  { base: "LST", type: "A320" },
  { base: "NTL", type: "A320" },
  { base: "MCY", type: "A320" },
  { base: "AKL", type: "A20N" },
  { base: "CHC", type: "A320" },
];
