import { assertEquals } from "jsr:@std/assert";
import {
  createHandler,
  type EnrichmentResult,
  type Job,
  type RpcFunction,
  type WorkerEnv,
} from "./index.ts";

const env: WorkerEnv = {
  serviceRoleKey: "service-role-test-key",
  supabaseUrl: "http://127.0.0.1:54321",
  workerSecret: "worker-secret",
};

function request(token?: string, body: unknown = {}) {
  const headers = new Headers({ "content-type": "application/json" });
  if (token !== undefined) {
    headers.set("authorization", token);
  }
  return new Request("http://localhost/enrich-word-validation", {
    body: JSON.stringify(body),
    headers,
    method: "POST",
  });
}

Deno.test("enrichment worker rejects missing bearer token before claiming jobs", async () => {
  const calls: Array<{ name: string; payload: Record<string, unknown> }> = [];
  const handler = createHandler({
    env,
    rpc: ((name, payload) => {
      calls.push({ name, payload });
      return Promise.resolve([]);
    }) as RpcFunction,
  });

  const response = await handler(request());

  assertEquals(response.status, 401);
  assertEquals(calls.length, 0);
});

Deno.test("enrichment worker rejects invalid bearer token before claiming jobs", async () => {
  const calls: Array<{ name: string; payload: Record<string, unknown> }> = [];
  const handler = createHandler({
    env,
    rpc: ((name, payload) => {
      calls.push({ name, payload });
      return Promise.resolve([]);
    }) as RpcFunction,
  });

  const response = await handler(request("Bearer wrong-secret"));

  assertEquals(response.status, 401);
  assertEquals(calls.length, 0);
});

Deno.test("enrichment worker accepts valid bearer token and clamps claim limit", async () => {
  const calls: Array<{ name: string; payload: Record<string, unknown> }> = [];
  const handler = createHandler({
    env,
    rpc: ((name, payload) => {
      calls.push({ name, payload });
      return Promise.resolve([]);
    }) as RpcFunction,
  });

  const response = await handler(
    request("Bearer worker-secret", { limit: 1000 }),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body, { processed: 0, results: [] });
  assertEquals(calls, [
    {
      name: "claim_word_validation_enrichment_jobs",
      payload: { p_limit: 25, p_lock_seconds: 300 },
    },
  ]);
});

Deno.test("enrichment worker records provider failure and leaves retry timing to SQL backoff", async () => {
  const job: Job = {
    attempts: 1,
    category: "Place",
    display_answer: "Lagos",
    id: "00000000-0000-0000-0000-000000000001",
    normalized_answer: "lagos",
  };
  const calls: Array<{ name: string; payload: Record<string, unknown> }> = [];
  const rpc = ((name, payload) => {
    calls.push({ name, payload });
    if (name === "claim_word_validation_enrichment_jobs") {
      return Promise.resolve([job]);
    }
    return Promise.resolve(undefined);
  }) as RpcFunction;
  const enrich = (() => {
    throw new Error("wikidata:429");
  }) as () => Promise<EnrichmentResult>;
  const handler = createHandler({ enrich, env, rpc });

  const response = await handler(request("Bearer worker-secret", { limit: 1 }));
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.processed, 1);
  assertEquals(body.results[0], {
    error: "wikidata:429",
    id: job.id,
    status: "failed",
  });
  assertEquals(calls.map((call) => call.name), [
    "claim_word_validation_enrichment_jobs",
    "fail_word_validation_enrichment",
    "record_word_validation_enrichment_event",
  ]);
  assertEquals(calls[1].payload, {
    p_error: "wikidata:429",
    p_job_id: job.id,
  });
  assertEquals(calls[2].payload.p_provider, "background_enrichment");
  assertEquals(calls[2].payload.p_success, false);
});
