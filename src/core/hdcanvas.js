// HD canvas textures: every painted texture (signs, facades, kasi walls,
// boards) is drawn at TEX_SCALE x its old size. The 2D context is pre-scaled,
// so the drawing code keeps its old numbers and just comes out sharper.
export const TEX_SCALE = 2;

// Make a canvas w x h in "old" units (really w*k x h*k pixels), ctx scaled.
export function hdCanvas(w, h, k = TEX_SCALE, opts) {
  const c = document.createElement('canvas');
  c.width = Math.round(w * k);
  c.height = Math.round(h * k);
  const g = opts ? c.getContext('2d', opts) : c.getContext('2d');
  g.scale(k, k);
  return c;
}
