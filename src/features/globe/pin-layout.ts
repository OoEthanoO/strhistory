export interface PinPoint { id: string; x: number; y: number }
export interface PinCluster { leader: string; count: number }

/**
 * Pins never move from their places. Where dots would overlap on screen, one
 * pin (listed in `first`, e.g. the selected note, otherwise the earliest id)
 * stays and carries the count; the others are hidden until zooming in
 * separates them. Leaders are chosen greedily, so a group never spans more
 * than `radius` from its leader.
 */
export function pinClusters(points: PinPoint[], radius = 18, first: string[] = []): Map<string, PinCluster> {
  const rank = (id: string) => (first.includes(id) ? first.indexOf(id) : first.length);
  const ordered = [...points].sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
  const leaders: PinPoint[] = [];
  const leaderOf = new Map<string, string>();
  for (const point of ordered) {
    const leader = leaders.find((other) => Math.hypot(point.x - other.x, point.y - other.y) < radius);
    if (leader) leaderOf.set(point.id, leader.id);
    else { leaders.push(point); leaderOf.set(point.id, point.id); }
  }
  const counts = new Map<string, number>();
  for (const leader of leaderOf.values()) counts.set(leader, (counts.get(leader) ?? 0) + 1);
  return new Map([...leaderOf].map(([id, leader]) => [id, { leader, count: counts.get(leader)! }]));
}
