/**
 * /version.json — which commit this build came from. The deploy script sets
 * GIT_SHA and checks this file after switching releases, so "deployed" means
 * "the new commit is what the server is actually serving".
 */
import type { APIRoute } from 'astro';

export const GET: APIRoute = () =>
  new Response(
    JSON.stringify({
      commit: process.env.GIT_SHA ?? 'dev',
      builtAt: new Date().toISOString(),
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
