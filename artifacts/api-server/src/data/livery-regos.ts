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

// Four reserve aircraft kept idle at the main hubs (one each). Held out of the
// daily rotation and available there for same-airport swaps.
export const HUB_RESERVES: Array<{ registration: string; base: string }> = [
  { registration: "VH-VQG", base: "BNE" },
  { registration: "VH-A5F", base: "MEL" },
  { registration: "VH-OFE", base: "SYD" },
  { registration: "VH-VKF", base: "PER" },
];
