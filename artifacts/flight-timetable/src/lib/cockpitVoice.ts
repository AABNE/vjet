// Always-on voice for the shared cockpit — a small WebRTC mesh (fine for 2-4
// people). No push-to-talk: once your mic is on, it streams continuously like a
// Discord call. Signalling (offer/answer/ICE) is relayed through the cockpit SSE
// + a POST endpoint; this class just manages the peer connections and audio.

type SignalData = { type: "offer" | "answer" | "ice"; sdp?: any; candidate?: any };

import { apiGet } from "./api";

const DEFAULT_ICE: RTCIceServer[] = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];

export class VoiceManager {
  private myId: number;
  private send: (to: number, data: SignalData) => void;
  private onStatus: (connected: boolean) => void;
  private peers = new Map<number, RTCPeerConnection>();
  private audioEls = new Map<number, HTMLAudioElement>();
  private local: MediaStream | null = null;
  private started = false;
  // STUN + (when configured server-side) a TURN relay for cross-network calls.
  private iceServers: RTCIceServer[] = DEFAULT_ICE;

  // Rolling recorder: mixes local mic + every remote peer and keeps roughly the
  // last couple of minutes, so a report can attach what the call sounded like.
  private audioCtx: AudioContext | null = null;
  private mixDest: MediaStreamAudioDestinationNode | null = null;
  private recorder: MediaRecorder | null = null;
  private recMime = "";
  private headerChunk: Blob | null = null;
  private tail: Blob[] = [];
  private static TAIL_CAP = 60; // ~2 min at a 2s timeslice

  constructor(myId: number, send: (to: number, data: SignalData) => void, onStatus: (connected: boolean) => void) {
    this.myId = myId; this.send = send; this.onStatus = onStatus;
  }

  async start(): Promise<boolean> {
    if (this.started) return true;
    try {
      this.local = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      try {
        const cfg = await apiGet<{ iceServers: RTCIceServer[] }>("/api/cockpit/ice");
        if (cfg?.iceServers?.length) this.iceServers = cfg.iceServers;
      } catch { /* fall back to STUN-only */ }
      this.started = true;
      this.startRecorder();
      return true;
    } catch { return false; }
  }

  // Build the mix graph + start a rolling MediaRecorder. Best-effort: if the
  // browser can't record (e.g. Safari), captureClip() just returns null.
  private startRecorder(): void {
    if (this.recorder || !this.local) return;
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctx || typeof MediaRecorder === "undefined") return;
      this.audioCtx = new Ctx();
      this.mixDest = this.audioCtx.createMediaStreamDestination();
      this.mixInto(this.local);
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find((m) => MediaRecorder.isTypeSupported(m));
      if (!mime) return;
      this.recMime = mime;
      this.recorder = new MediaRecorder(this.mixDest.stream, { mimeType: mime, audioBitsPerSecond: 24000 });
      this.recorder.ondataavailable = (e) => {
        if (!e.data || e.data.size === 0) return;
        if (!this.headerChunk) { this.headerChunk = e.data; return; }
        this.tail.push(e.data);
        if (this.tail.length > VoiceManager.TAIL_CAP) this.tail.shift();
      };
      this.recorder.start(2000);
    } catch { /* recording is best-effort */ }
  }

  private mixInto(stream: MediaStream): void {
    try {
      if (!this.audioCtx || !this.mixDest) return;
      if (this.audioCtx.state === "suspended") void this.audioCtx.resume();
      this.audioCtx.createMediaStreamSource(stream).connect(this.mixDest);
    } catch { /* ignore */ }
  }

  // A webm clip of roughly the last two minutes of the call (header + recent
  // audio), or null if nothing was recorded.
  captureClip(): Blob | null {
    if (!this.headerChunk || !this.recMime) return null;
    try { return new Blob([this.headerChunk, ...this.tail], { type: this.recMime }); } catch { return null; }
  }

  get muted(): boolean { return this.local ? !this.local.getAudioTracks().some((t) => t.enabled) : true; }
  setMuted(m: boolean): void { this.local?.getAudioTracks().forEach((t) => { t.enabled = !m; }); }

  private pc(peerId: number): RTCPeerConnection {
    let pc = this.peers.get(peerId);
    if (pc) return pc;
    pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this.local?.getTracks().forEach((t) => pc!.addTrack(t, this.local!));
    pc.onicecandidate = (e) => { if (e.candidate) this.send(peerId, { type: "ice", candidate: e.candidate.toJSON() }); };
    pc.ontrack = (e) => {
      let el = this.audioEls.get(peerId);
      if (!el) { el = new Audio(); el.autoplay = true; this.audioEls.set(peerId, el); }
      el.srcObject = e.streams[0];
      el.play().catch(() => { /* autoplay may need a gesture */ });
      // Also feed this peer into the recording mix.
      this.mixInto(e.streams[0]);
    };
    pc.onconnectionstatechange = () => {
      const anyConnected = [...this.peers.values()].some((p) => p.connectionState === "connected");
      this.onStatus(anyConnected);
    };
    this.peers.set(peerId, pc);
    return pc;
  }

  // Reconcile the current peer list: offer to any new peer we should initiate to.
  async syncPeers(peerIds: number[]): Promise<void> {
    if (!this.started) return;
    for (const id of peerIds) {
      if (id === this.myId || this.peers.has(id)) continue;
      // Deterministic initiator: the lower id makes the offer.
      if (this.myId < id) {
        const pc = this.pc(id);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        this.send(id, { type: "offer", sdp: offer });
      }
    }
    // Drop peers that have gone.
    for (const id of [...this.peers.keys()]) if (!peerIds.includes(id)) this.removePeer(id);
  }

  async onSignal(from: number, data: SignalData): Promise<void> {
    if (!this.started) return;
    const pc = this.pc(from);
    try {
      if (data.type === "offer") {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.send(from, { type: "answer", sdp: answer });
      } else if (data.type === "answer") {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      } else if (data.type === "ice" && data.candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      }
    } catch { /* ignore transient signalling errors */ }
  }

  removePeer(id: number): void {
    this.peers.get(id)?.close(); this.peers.delete(id);
    const el = this.audioEls.get(id); if (el) { el.srcObject = null; this.audioEls.delete(id); }
  }

  stop(): void {
    for (const id of [...this.peers.keys()]) this.removePeer(id);
    try { this.recorder?.state !== "inactive" && this.recorder?.stop(); } catch { /* */ }
    try { void this.audioCtx?.close(); } catch { /* */ }
    this.recorder = null; this.audioCtx = null; this.mixDest = null;
    this.headerChunk = null; this.tail = [];
    this.local?.getTracks().forEach((t) => t.stop());
    this.local = null; this.started = false;
  }
}
