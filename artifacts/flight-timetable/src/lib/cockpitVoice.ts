// Always-on voice for the shared cockpit — a small WebRTC mesh (fine for 2-4
// people). No push-to-talk: once your mic is on, it streams continuously like a
// Discord call. Signalling (offer/answer/ICE) is relayed through the cockpit SSE
// + a POST endpoint; this class just manages the peer connections and audio.

type SignalData = { type: "offer" | "answer" | "ice"; sdp?: any; candidate?: any };

const ICE = { iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }] };

export class VoiceManager {
  private myId: number;
  private send: (to: number, data: SignalData) => void;
  private onStatus: (connected: boolean) => void;
  private peers = new Map<number, RTCPeerConnection>();
  private audioEls = new Map<number, HTMLAudioElement>();
  private local: MediaStream | null = null;
  private started = false;

  constructor(myId: number, send: (to: number, data: SignalData) => void, onStatus: (connected: boolean) => void) {
    this.myId = myId; this.send = send; this.onStatus = onStatus;
  }

  async start(): Promise<boolean> {
    if (this.started) return true;
    try {
      this.local = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      this.started = true;
      return true;
    } catch { return false; }
  }

  get muted(): boolean { return this.local ? !this.local.getAudioTracks().some((t) => t.enabled) : true; }
  setMuted(m: boolean): void { this.local?.getAudioTracks().forEach((t) => { t.enabled = !m; }); }

  private pc(peerId: number): RTCPeerConnection {
    let pc = this.peers.get(peerId);
    if (pc) return pc;
    pc = new RTCPeerConnection(ICE);
    this.local?.getTracks().forEach((t) => pc!.addTrack(t, this.local!));
    pc.onicecandidate = (e) => { if (e.candidate) this.send(peerId, { type: "ice", candidate: e.candidate.toJSON() }); };
    pc.ontrack = (e) => {
      let el = this.audioEls.get(peerId);
      if (!el) { el = new Audio(); el.autoplay = true; this.audioEls.set(peerId, el); }
      el.srcObject = e.streams[0];
      el.play().catch(() => { /* autoplay may need a gesture */ });
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
    this.local?.getTracks().forEach((t) => t.stop());
    this.local = null; this.started = false;
  }
}
