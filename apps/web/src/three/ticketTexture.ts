import * as THREE from "three";

export type TicketFace = {
  kicker: string;
  title: string;
  subtitle: string;
  code: string;
  stamp: string;
  accent: string; // CSS color
  accent2: string; // CSS color
};

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, size: number, weight: string, family: string) {
  let current = size;
  do {
    ctx.font = `${weight} ${current}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    current -= 4;
  } while (current > 28);
  return current;
}

function drawFront(ctx: CanvasRenderingContext2D, w: number, h: number, face: TicketFace) {
  ctx.clearRect(0, 0, w, h);
  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, "#130b33");
  bg.addColorStop(0.55, "#0a0820");
  bg.addColorStop(1, "#1a0b2e");
  roundRect(ctx, 4, 4, w - 8, h - 8, 46);
  ctx.fillStyle = bg;
  ctx.fill();

  // Accent glow blobs
  const glow = ctx.createRadialGradient(w * 0.82, h * 0.1, 10, w * 0.82, h * 0.1, w * 0.55);
  glow.addColorStop(0, face.accent + "88");
  glow.addColorStop(1, "transparent");
  ctx.fillStyle = glow;
  ctx.fill();
  const glow2 = ctx.createRadialGradient(w * 0.1, h, 10, w * 0.1, h, w * 0.5);
  glow2.addColorStop(0, face.accent2 + "66");
  glow2.addColorStop(1, "transparent");
  ctx.fillStyle = glow2;
  ctx.fill();

  // Fine grid
  ctx.save();
  roundRect(ctx, 4, 4, w - 8, h - 8, 46);
  ctx.clip();
  ctx.strokeStyle = "rgba(255,255,255,0.045)";
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = 0; y < h; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  ctx.restore();

  // Border
  const border = ctx.createLinearGradient(0, 0, w, h);
  border.addColorStop(0, face.accent);
  border.addColorStop(1, face.accent2);
  roundRect(ctx, 6, 6, w - 12, h - 12, 44);
  ctx.strokeStyle = border;
  ctx.lineWidth = 5;
  ctx.stroke();

  const stub = w * 0.72;
  // Perforation
  ctx.setLineDash([10, 12]);
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(stub, 40); ctx.lineTo(stub, h - 40); ctx.stroke();
  ctx.setLineDash([]);

  const display = "Unbounded, 'DM Sans', sans-serif";
  const mono = "'JetBrains Mono', 'DM Mono', monospace";

  ctx.fillStyle = face.accent;
  ctx.font = `600 26px ${mono}`;
  ctx.fillText(face.kicker.toUpperCase(), 60, 86);

  ctx.fillStyle = "#ffffff";
  const titleSize = fitText(ctx, face.title, stub - 120, 92, "800", display);
  ctx.font = `800 ${titleSize}px ${display}`;
  ctx.fillText(face.title, 56, 120 + titleSize);

  ctx.fillStyle = "rgba(225,220,255,0.72)";
  ctx.font = `500 30px ${mono}`;
  ctx.fillText(face.subtitle, 60, 300);

  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = `500 22px ${mono}`;
  ctx.fillText("CODE", 60, 392);
  ctx.fillStyle = "#ffffff";
  ctx.font = `600 34px ${mono}`;
  ctx.fillText(face.code, 60, 436);

  // Stamp on stub
  ctx.save();
  ctx.translate(stub + (w - stub) / 2, h / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.fillStyle = face.accent2;
  ctx.font = `800 44px ${display}`;
  ctx.fillText(face.stamp, 0, -28);
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.font = `500 22px ${mono}`;
  ctx.fillText("ONE ENTRY · SAME ODDS", 0, 22);
  ctx.restore();

  // Barcode
  let x = stub + 34;
  const seed = face.code.split("").reduce((sum, char) => sum + char.charCodeAt(0), 7);
  for (let i = 0; x < w - 40; i++) {
    const bar = 2 + ((seed * (i + 3)) % 5);
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillRect(x, h - 96, bar, 52);
    x += bar + 4;
  }
}

function drawBack(ctx: CanvasRenderingContext2D, w: number, h: number, face: TicketFace) {
  ctx.clearRect(0, 0, w, h);
  const bg = ctx.createLinearGradient(w, 0, 0, h);
  bg.addColorStop(0, "#0d0a28");
  bg.addColorStop(1, "#160a26");
  roundRect(ctx, 4, 4, w - 8, h - 8, 46);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.save();
  ctx.clip();
  // Spider-web motif
  ctx.translate(w / 2, h / 2);
  ctx.strokeStyle = face.accent + "55";
  ctx.lineWidth = 2;
  const spokes = 16;
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * w, Math.sin(a) * w); ctx.stroke();
  }
  for (let ring = 1; ring < 12; ring++) {
    const r = 26 * Math.pow(1.32, ring);
    ctx.beginPath();
    for (let i = 0; i <= spokes; i++) {
      const a = (i / spokes) * Math.PI * 2;
      const mid = ((i - 0.5) / spokes) * Math.PI * 2;
      if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else ctx.quadraticCurveTo(Math.cos(mid) * r * 0.9, Math.sin(mid) * r * 0.9, Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.stroke();
  }
  ctx.restore();
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffffff";
  ctx.font = `800 84px Unbounded, 'DM Sans', sans-serif`;
  ctx.fillText("FAIR DROP", w / 2, h / 2 + 28);
  const border = ctx.createLinearGradient(0, 0, w, h);
  border.addColorStop(0, face.accent2);
  border.addColorStop(1, face.accent);
  roundRect(ctx, 6, 6, w - 12, h - 12, 44);
  ctx.strokeStyle = border;
  ctx.lineWidth = 5;
  ctx.stroke();
}

export function createTicketTextures(face: TicketFace) {
  const make = (draw: typeof drawFront) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1024; canvas.height = 512;
    const ctx = canvas.getContext("2d")!;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    const paint = () => { draw(ctx, canvas.width, canvas.height, face); texture.needsUpdate = true; };
    paint();
    // Repaint once web fonts are ready so the display font is used.
    void document.fonts?.ready.then(paint);
    return texture;
  };
  return { front: make(drawFront), back: make(drawBack) };
}
