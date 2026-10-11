// Computed text contrast: hides the text, screenshots what is really painted behind it, and compares the real text colour
// with the closest-in-brightness background pixel (the worst case). Not eyeballed. Used by the browser scripts.
/** `pill`: skip the rounded ends, where the page behind the pill shows through the clip rectangle and is not its background.
 * Returns the lowest contrast ratio of the first element matching `selector` (scrolled to the middle, clear of the sticky bar). */
export async function contrastOf(page, selector, { bar = 76, pill = false } = {}) {
  const el = page.locator(selector).first();
  if (!(await el.count())) return null;
  await el.evaluate((n) => n.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(200);
  const box = await el.boundingBox();
  if (!box || box.width < 4 || box.height < 4) return null;
  const { color } = await el.evaluate((node) => {
    const color = getComputedStyle(node).color; // read the real colour FIRST
    node.style.setProperty("color", "transparent", "important");
    node.querySelectorAll("*").forEach((c) => c.style.setProperty("color", "transparent", "important"));
    return { color };
  });
  const vp = page.viewportSize();
  const x0 = Math.max(0, box.x), y0 = Math.max(bar, box.y);
  const clip = { x: x0, y: y0, width: Math.max(4, Math.min(box.x + box.width, vp.width) - x0), height: Math.max(4, Math.min(box.y + box.height, vp.height) - y0) };
  if (pill) {
    const dx = Math.min(Math.floor(box.height / 2), Math.floor(clip.width / 4)), dy = Math.min(3, Math.floor(clip.height / 4));
    clip.x += dx; clip.width -= 2 * dx; clip.y += dy; clip.height -= 2 * dy;
  }
  const png = await page.screenshot({ clip });
  await el.evaluate((node) => {
    node.style.removeProperty("color");
    node.querySelectorAll("*").forEach((c) => c.style.removeProperty("color"));
  });
  const ratio = await page.evaluate(async ([b64, col]) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const cv = new OffscreenCanvas(bmp.width, bmp.height);
    const g = cv.getContext("2d");
    g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
    const lum = ([r, gg, b]) => {
      const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(gg) + 0.0722 * f(b);
    };
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(col);
    const fg = lum([+m[1], +m[2], +m[3]]);
    let min = 21;
    for (let i = 0; i < d.length; i += 4 * 3) {
      const L = lum([d[i], d[i + 1], d[i + 2]]);
      const r = (Math.max(fg, L) + 0.05) / (Math.min(fg, L) + 0.05);
      if (r < min) min = r;
    }
    return min;
  }, [png.toString("base64"), color]);
  return Math.round(ratio * 100) / 100;
}
