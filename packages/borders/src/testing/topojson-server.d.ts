// topojson-server ships no types (and @types/topojson-server is not installed); tests only need this.
declare module 'topojson-server' {
  export function topology(objects: Record<string, unknown>, quantization?: number): {
    type: 'Topology';
    objects: Record<string, unknown>;
    arcs: unknown[];
    transform?: { scale: [number, number]; translate: [number, number] };
    bbox?: number[];
  };
}
