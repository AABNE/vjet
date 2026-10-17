// Jetstar MSFS liveries, grouped by add-on aircraft. Each add-on maps to a hub
// fleet code so pilots see only liveries relevant to their assigned aircraft.
// Links are to flightsim.to (open externally). Do not invent registrations.

export type FleetCode = "A320" | "A20N" | "A21N" | "B788";
export type SimVersion = "MSFS 2020" | "MSFS 2024" | "MSFS 2020 & 2024";

export interface LiveryEntry {
  sim: SimVersion;
  registrations?: string; // as published; may be a list or a note
  livery?: string;        // livery name, when distinct from the registration
  url: string;
}

export interface LiveryAddon {
  addon: string;      // e.g. "Fenix A320"
  developer: string;  // e.g. "Fenix"
  fleet: FleetCode;
  entries: LiveryEntry[];
}

export const FLEET_LABELS: Record<FleetCode, string> = {
  A320: "Airbus A320",
  A20N: "Airbus A320neo",
  A21N: "Airbus A321neo",
  B788: "Boeing 787",
};

export const LIVERIES: LiveryAddon[] = [
  {
    addon: "Fenix A320",
    developer: "Fenix Simulations",
    fleet: "A320",
    entries: [
      { sim: "MSFS 2024", registrations: "VH-X3H, VH-X3J, VH-X3L, VH-X3N", url: "https://flightsim.to/addon/105089/jetstar-a320-shaklet-vh-x3-pack-vh-x3h-x3j-x3l-and-x3n" },
      { sim: "MSFS 2024", registrations: "VH-VF series", url: "https://flightsim.to/addon/106898/jetstar-a320-vh-vf-series-sharklet-pack" },
      { sim: "MSFS 2024", registrations: "VH-VFY", livery: "Flying with Pride", url: "https://flightsim.to/addon/93636/jetstar-a320-vh-vfy-flying-with-pride-8k-w-cabin" },
      { sim: "MSFS 2020", registrations: "VH-XNJ, VH-XSJ, VH-YXQ, VH-YXS, VH-YXT, VH-YXU, VH-YXV, VH-YXW", url: "https://flightsim.to/addon/91690/jetstar-a320-sharklet-pack-vh-xnj-xsj-yxq-yxs-yxt-yxu-yxv-yxw-8k-w-cabin" },
      { sim: "MSFS 2020", registrations: "VH-VFY", livery: "Flying with Pride", url: "https://flightsim.to/addon/84528/jetstar-flying-with-pride-vh-vfy-fenix-a320-iae-sharklets" },
      { sim: "MSFS 2020", registrations: "VH-VQG, VH-VQH, VH-VQK, VH-VQL, VH-VQM", livery: "Classic pack", url: "https://flightsim.to/addon/82539/jetstar-a320-classic-pack-vh-vqg-vh-vqh-vh-vqk-vh-vql-vh-vqm-with-cabin-8k-4k" },
    ],
  },
  {
    addon: "LatinVFR A320ceo",
    developer: "LatinVFR",
    fleet: "A320",
    entries: [
      { sim: "MSFS 2020", registrations: "VH-VGF", livery: "10th Anniversary / Jetstar Generation", url: "https://flightsim.to/addon/98911/jetstar-australia-10th-anniversary-jetstargeneration-vh-vgf-latinvfr-a320-ceo-iae-8k" },
    ],
  },
  {
    addon: "FlyByWire A320neo",
    developer: "FlyByWire (A32NX)",
    fleet: "A20N",
    entries: [
      { sim: "MSFS 2020", registrations: "VH-A5A, VH-A5B, VH-A5C, VH-A5D, VH-A5E, VH-A5F", livery: "Fleet pack", url: "https://flightsim.to/addon/86171/jetstar-vh-a5a-for-a32nx-8k" },
      { sim: "MSFS 2020", registrations: "VH-A5A", livery: "Alternative livery", url: "https://flightsim.to/addon/85779/jetstar-vh-a5a-flybywire-a32nx" },
      { sim: "MSFS 2020", registrations: "VH-VGF", livery: "Jetstar Generation", url: "https://flightsim.to/addon/13467/fbw-a32nx-a320neo-jetstar-generation-8k-vh-vgf" },
      { sim: "MSFS 2024", registrations: "VH-A5A, VH-A5B, VH-A5C, VH-A5D, VH-A5E, VH-A5F", livery: "Fleet pack", url: "https://flightsim.to/addon/86171/jetstar-vh-a5a-for-a32nx-8k" },
    ],
  },
  {
    addon: "FSLabs A321neo",
    developer: "FSLabs",
    fleet: "A21N",
    entries: [
      { sim: "MSFS 2020 & 2024", registrations: "VH-OFP", url: "https://flightsim.to/addon/106466/jetstar-australia-fslabs-a321neo" },
    ],
  },
  {
    addon: "iniBuilds A321neo",
    developer: "iniBuilds",
    fleet: "A21N",
    entries: [
      { sim: "MSFS 2024", registrations: "VH-OFW", url: "https://flightsim.to/addon/87735/inibuilds-a321neo-jetstar-airways-msfs2024" },
    ],
  },
  {
    addon: "LatinVFR A321neo",
    developer: "LatinVFR",
    fleet: "A21N",
    entries: [
      { sim: "MSFS 2020", registrations: "VH-OFL", url: "https://flightsim.to/addon/58948/jetstar-a321neo-vh-ofl-8k" },
      { sim: "MSFS 2020", registrations: "VH-OFE", url: "https://flightsim.to/addon/52821/jetstar-vh-ofe-latinvfr-a321neo" },
    ],
  },
  {
    addon: "Kuro Boeing 787-8",
    developer: "Kuro",
    fleet: "B788",
    entries: [
      { sim: "MSFS 2020", registrations: "VH-VKD", url: "https://flightsim.to/addon/57902/jetstar-vh-vkd-kuro-b787-8-v2" },
      { sim: "MSFS 2020", registrations: "VH-VKF", url: "https://flightsim.to/addon/57722/jetstar-vh-vkf-kuro-b787-8-v2" },
      { sim: "MSFS 2020", registrations: "VH-VKJ", url: "https://flightsim.to/addon/48698/kuro-boeing-787-800-jetstar-vh-vkj" },
    ],
  },
  {
    addon: "BravoAirspace Boeing 787-8",
    developer: "BravoAirspace",
    fleet: "B788",
    entries: [
      { sim: "MSFS 2020 & 2024", registrations: "Multiple registrations — fleet pack", url: "https://flightsim.to/addon/106665/jetstar-fleet-bravoairspace-b787-8-msfs2020-24" },
    ],
  },
  {
    addon: "Asobo Boeing 787-10",
    developer: "Asobo (default)",
    fleet: "B788",
    entries: [
      { sim: "MSFS 2020", registrations: "Jetstar 787-10 (registration not specified)", url: "https://flightsim.to/addon/18553/787-10-jetstar-airways-8k-read-description" },
    ],
  },
];
