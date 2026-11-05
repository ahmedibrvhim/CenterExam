// Browser part of the map reader: renders a PDF page, asks lib/maps.ts where the map is, and cuts it out as a picture.
// Nothing is uploaded: the picture stays in the browser until the exam is made (and it is sent to the AI only for map questions).
import { findGraphicRegions, type Box } from "@/lib/maps";

export type MapShot = { page: number; dataUrl: string; w: number; h: number };

const FIND_W = 700;     // the page is searched at this width (fast)
const CUT_W = 1700;     // and cut out of a sharper render of the same page
const OUT_W = 1000;     // widest picture that is kept (a map printed 120 mm wide is still sharp at this size)
const MAX_PER_PAGE = 2;

async function openPdf(file: File) {
  // @ts-ignore - pdfjs-dist 3.x ships without usable types for this path
  const pdfjs: any = await import("pdfjs-dist/build/pdf");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.js", import.meta.url).toString();
  return { pdfjs, doc: await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise };
}

// The pictures that are really placed on the page (a map pasted into a Word exam is one of them): their exact boxes, in pixels of a
// page rendered FIND_W wide. A scan of the whole page (one picture that covers it) and tiny pictures (logos, bullets) are ignored.
async function imageBoxes(pdfjs: any, page: any, viewport: any): Promise<Box[]> {
  const OPS = pdfjs.OPS, U = pdfjs.Util;
  const ops = await page.getOperatorList();
  let ctm = [1, 0, 0, 1, 0, 0]; const stack: number[][] = []; const out: Box[] = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i], a = ops.argsArray[i];
    if (fn === OPS.save) stack.push(ctm.slice());
    else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform) ctm = U.transform(ctm, a);
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintJpegXObject || fn === OPS.paintImageXObjectRepeat) {
      const m = U.transform(viewport.transform, ctm);
      const xs = [m[4], m[0] + m[4], m[2] + m[4], m[0] + m[2] + m[4]], ys = [m[5], m[1] + m[5], m[3] + m[5], m[1] + m[3] + m[5]];
      const x = Math.min(...xs), y = Math.min(...ys);
      out.push({ x: Math.round(x), y: Math.round(y), w: Math.round(Math.max(...xs) - x), h: Math.round(Math.max(...ys) - y) });
    }
  }
  const W = viewport.width, H = viewport.height;
  return out
    .filter((b) => b.w >= W * 0.15 && b.h >= H * 0.07 && b.w * b.h < W * H * 0.7)
    .sort((a, b) => b.w * b.h - a.w * a.h);
}

async function renderWidth(doc: any, n: number, width: number): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: width / base.width });
  const c = document.createElement("canvas");
  c.width = Math.round(viewport.width); c.height = Math.round(viewport.height);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  page.cleanup();
  return c;
}

// pages = 1-based page numbers worth searching (the caller only passes pages whose text talks about a map)
export async function scanMaps(file: File, pages: number[], signal: AbortSignal): Promise<MapShot[]> {
  if (!pages.length) return [];
  const { pdfjs, doc } = await openPdf(file);
  const out: MapShot[] = [];
  try {
    for (const n of pages) {
      if (signal.aborted) throw new Error("aborted");
      let small: HTMLCanvasElement | null = null;
      try {
        small = await renderWidth(doc, n, FIND_W);
        const px = small.getContext("2d")!.getImageData(0, 0, small.width, small.height);
        let regions: Box[] = [];
        try { const pg = await doc.getPage(n); regions = await imageBoxes(pdfjs, pg, pg.getViewport({ scale: small.width / pg.getViewport({ scale: 1 }).width })); } catch {}
        if (!regions.length) regions = findGraphicRegions({ data: px.data, width: small.width, height: small.height });
        regions = regions.slice(0, MAX_PER_PAGE);
        if (!regions.length) continue;
        const big = await renderWidth(doc, n, CUT_W);
        const k = big.width / small.width;
        for (const r of regions) {
          const m = 8; // a little margin so a thin border line is not cut in half
          const sx = Math.max(0, Math.round((r.x - m) * k)), sy = Math.max(0, Math.round((r.y - m) * k));
          const sw = Math.min(big.width - sx, Math.round((r.w + 2 * m) * k)), sh = Math.min(big.height - sy, Math.round((r.h + 2 * m) * k));
          if (sw < 80 || sh < 60) continue;
          const s = Math.min(1, OUT_W / sw);
          const c = document.createElement("canvas");
          c.width = Math.round(sw * s); c.height = Math.round(sh * s);
          const ctx = c.getContext("2d")!;
          ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(big, sx, sy, sw, sh, 0, 0, c.width, c.height);
          out.push({ page: n, dataUrl: c.toDataURL("image/jpeg", 0.85), w: c.width, h: c.height });
          c.width = c.height = 0;
        }
        big.width = big.height = 0;
      } catch (e) {
        if (signal.aborted) throw e;          // one bad page must not stop the whole search
      } finally { if (small) small.width = small.height = 0; }
      await new Promise((r) => setTimeout(r, 0)); // let the browser repaint
    }
  } finally { doc.destroy?.(); }
  return out;
}
