import { Link } from "wouter";
import { ArrowLeft, Compass } from "lucide-react";

export default function NotFound(){
 return <div className="relative grid min-h-[60vh] place-items-center overflow-hidden rounded-xl border border-[#d9d2c5] bg-[#faf8f1] px-6 py-14 text-center" data-testid="page-not-found">
  <div className="absolute -right-8 -top-16 font-display text-[220px] font-bold leading-none text-[#f0eadb]">404</div>
  <div className="relative max-w-lg"><div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#f6c900]"><Compass className="h-6 w-6"/></div><div className="mt-6 font-mono text-[10px] font-bold uppercase tracking-[.24em] text-[#927000]">Off the flight plan</div><h1 className="mt-2 font-display text-5xl font-bold uppercase">Route not found</h1><p className="mt-3 text-sm leading-6 text-[#69717c]">This page isn't on the current ops chart. Return to your dispatch board and pick up from there.</p><Link href="/timetable" data-testid="link-not-found-timetable" className="mt-6 inline-flex items-center gap-2 rounded bg-[#202d40] px-5 py-3 text-xs font-bold uppercase tracking-wider text-white"><ArrowLeft className="h-4 w-4"/>Back to timetable</Link></div>
 </div>;
}
