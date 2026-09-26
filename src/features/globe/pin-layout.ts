export interface PinPoint { id: string; x: number; y: number }

/** Fan out nearby notes without changing their geographical coordinates.
 * Renderers draw a fine stem back to the actual position. */
export function pinOffsets(points: PinPoint[]): Map<string, [number, number]> {
  const groups: PinPoint[][] = [];
  for (const point of points) {
    const nearby = groups.filter((group) => group.some((other) => Math.hypot(point.x - other.x, point.y - other.y) < 28));
    if (!nearby.length) groups.push([point]);
    else {
      const merged = [point, ...nearby.flat()];
      for (const group of nearby) groups.splice(groups.indexOf(group), 1);
      groups.push(merged);
    }
  }
  const result = new Map<string, [number, number]>();
  for (const group of groups) {
    group.sort((a, b) => a.id.localeCompare(b.id));
    if (group.length === 1) { result.set(group[0].id, [0, 0]); continue; }
    const radius = Math.max(22, group.length * 5);
    const cx = group.reduce((sum, point) => sum + point.x, 0) / group.length;
    const cy = group.reduce((sum, point) => sum + point.y, 0) / group.length;
    group.forEach((point, index) => {
      const angle = -Math.PI / 2 + index * 2 * Math.PI / group.length;
      result.set(point.id, [cx + Math.cos(angle) * radius - point.x, cy + Math.sin(angle) * radius - point.y]);
    });
  }
  return result;
}
