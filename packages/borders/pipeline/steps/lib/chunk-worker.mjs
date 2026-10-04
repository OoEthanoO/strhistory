// Worker thread for lib/pool.mjs: builds chunk files (buildChunkLod) on request.
import { parentPort } from 'node:worker_threads';
import { buildChunkLod } from './chunkbuild.mjs';

parentPort.on('message', async ({ id, task }) => {
  try {
    parentPort.postMessage({ id, result: await buildChunkLod(task) });
  } catch (e) {
    parentPort.postMessage({ id, error: e?.stack ?? String(e) });
  }
});
