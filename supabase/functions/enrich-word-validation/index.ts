export type AnswerVerdict = "valid" | "invalid" | "disputed";
export type Job = {
  attempts: number;
  category: string;
  display_answer: string;
  id: string;
  normalized_answer: string;
};
export type EnrichmentResult = {
  confidence: number;
  failureReason?: string;
  latencyMs: number;
  source: string;
  sourceRef?: string;
  verdict: AnswerVerdict;
};
export type WorkerEnv = {
  serviceRoleKey: string;
  supabaseUrl: string;
  workerSecret: string;
};
export type RpcFunction = <T>(
  name: string,
  payload: Record<string, unknown>,
) => Promise<T>;
export type EnrichFunction = (job: Job) => Promise<EnrichmentResult>;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WORKER_SECRET = Deno.env.get("WORD_VALIDATION_WORKER_SECRET") ?? "";
const DEFAULT_LIMIT = 5;
const PROVIDER_TIMEOUT_MS = 2500;

const WIKIDATA_CATEGORY_ROOTS: Record<string, string[]> = {
  Animal: ["Q729"],
  Food: ["Q2095", "Q746549"],
  Job: ["Q12737077", "Q28640"],
  Name: ["Q5", "Q202444"],
  Place: ["Q2221906", "Q486972", "Q6256", "Q515"],
  Brand: ["Q431289", "Q167270", "Q4830453"],
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function createRpc(env: WorkerEnv): RpcFunction {
  return async function rpc<T>(
    name: string,
    payload: Record<string, unknown>,
  ): Promise<T> {
    const response = await fetch(`${env.supabaseUrl}/rest/v1/rpc/${name}`, {
      body: JSON.stringify(payload),
      headers: {
        apikey: env.serviceRoleKey,
        authorization: `Bearer ${env.serviceRoleKey}`,
        "content-type": "application/json",
      },
      method: "POST",
    });

    if (!response.ok) {
      throw new Error(
        `${name} failed: ${response.status} ${await response.text()}`,
      );
    }

    const responseBody = await response.text();

    if (!responseBody) {
      return undefined as T;
    }

    return JSON.parse(responseBody) as T;
  };
}

async function timeoutFetch(
  url: string,
  init?: RequestInit,
  timeoutMs = PROVIDER_TIMEOUT_MS,
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function wikidataEntityUrl(entityId: string) {
  return `https://www.wikidata.org/wiki/${entityId}`;
}

async function queryWikidata(job: Job): Promise<EnrichmentResult | null> {
  const roots = WIKIDATA_CATEGORY_ROOTS[job.category];

  if (!roots?.length) {
    return null;
  }

  const started = Date.now();
  const escapedAnswer = job.display_answer.replace(/\\/g, "\\\\").replace(
    /"/g,
    '\\"',
  );
  const values = roots.map((root) => `wd:${root}`).join(" ");
  const query = `
    SELECT ?item ?itemLabel ?root WHERE {
      VALUES ?root { ${values} }
      ?item rdfs:label "${escapedAnswer}"@en.
      {
        ?item wdt:P31/wdt:P279* ?root.
      } UNION {
        ?item wdt:P279* ?root.
      }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    LIMIT 3
  `;
  const url = `https://query.wikidata.org/sparql?format=json&query=${
    encodeURIComponent(query)
  }`;
  const response = await timeoutFetch(url, {
    headers: {
      accept: "application/sparql-results+json",
      "user-agent": "WordBrawlValidation/1.0 (local development)",
    },
  });
  const latencyMs = Date.now() - started;

  if (!response.ok) {
    throw new Error(`wikidata:${response.status}`);
  }

  const body = await response.json() as {
    results?: { bindings?: Array<{ item?: { value?: string } }> };
  };
  const firstItem = body.results?.bindings?.[0]?.item?.value;

  if (!firstItem) {
    return null;
  }

  const entityId = firstItem.split("/").pop() ?? firstItem;

  return {
    confidence: job.category === "Brand" ? 0.72 : 0.86,
    latencyMs,
    source: "wikidata",
    sourceRef: wikidataEntityUrl(entityId),
    verdict: "valid",
  };
}

async function queryDictionary(job: Job): Promise<EnrichmentResult | null> {
  if (job.category !== "Object") {
    return null;
  }

  const started = Date.now();
  const response = await timeoutFetch(
    `https://api.dictionaryapi.dev/api/v2/entries/en/${
      encodeURIComponent(job.display_answer)
    }`,
    { headers: { accept: "application/json" } },
  );
  const latencyMs = Date.now() - started;

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`dictionaryapi:${response.status}`);
  }

  const entries = await response.json() as Array<{ meanings?: unknown[] }>;
  const hasDefinition = entries.some((entry) =>
    (entry.meanings ?? []).length > 0
  );

  if (!hasDefinition) {
    return null;
  }

  return {
    confidence: 0.58,
    failureReason:
      "Dictionary confirms the word exists, but Object is broad; leave reviewable unless players accept it.",
    latencyMs,
    source: "dictionaryapi.dev",
    sourceRef: `https://api.dictionaryapi.dev/api/v2/entries/en/${
      encodeURIComponent(job.display_answer)
    }`,
    verdict: "disputed",
  };
}

export async function enrich(job: Job): Promise<EnrichmentResult> {
  const wikidataResult = await queryWikidata(job);

  if (wikidataResult) {
    return wikidataResult;
  }

  const dictionaryResult = await queryDictionary(job);

  if (dictionaryResult) {
    return dictionaryResult;
  }

  return {
    confidence: 0.25,
    failureReason: "No category-specific source confirmed this answer.",
    latencyMs: 0,
    source: "background_enrichment",
    verdict: "disputed",
  };
}

async function recordEvent(
  rpc: RpcFunction,
  job: Job,
  provider: string,
  success: boolean,
  result?: EnrichmentResult,
  error?: unknown,
) {
  await rpc("record_word_validation_enrichment_event", {
    p_category: job.category,
    p_error_code: error instanceof Error ? error.name : null,
    p_error_message: error instanceof Error ? error.message : null,
    p_job_id: job.id,
    p_latency_ms: result?.latencyMs ?? null,
    p_normalized_answer: job.normalized_answer,
    p_provider: provider,
    p_success: success,
    p_verdict: result?.verdict ?? null,
  });
}

export function createHandler(options?: {
  env?: WorkerEnv;
  enrich?: EnrichFunction;
  rpc?: RpcFunction;
}) {
  const env = options?.env ?? {
    serviceRoleKey: SERVICE_ROLE_KEY,
    supabaseUrl: SUPABASE_URL,
    workerSecret: WORKER_SECRET,
  };
  const rpc = options?.rpc ?? createRpc(env);
  const enrichJob = options?.enrich ?? enrich;

  return async function handler(request: Request) {
    if (!env.supabaseUrl || !env.serviceRoleKey || !env.workerSecret) {
      return jsonResponse({
        error: "Supabase service environment is not configured.",
      }, 500);
    }

    if (request.method !== "POST") {
      return jsonResponse({ error: "Use POST." }, 405);
    }

    const authorization = request.headers.get("authorization") ?? "";
    const expectedAuthorization = `Bearer ${env.workerSecret}`;

    if (authorization !== expectedAuthorization) {
      return jsonResponse({ error: "Unauthorized." }, 401);
    }

    const body = await request.json().catch(() => ({})) as { limit?: number };
    const limit = Math.max(1, Math.min(body.limit ?? DEFAULT_LIMIT, 25));
    const jobs = await rpc<Job[]>("claim_word_validation_enrichment_jobs", {
      p_limit: limit,
      p_lock_seconds: 300,
    });
    const results: Array<
      {
        id: string;
        status: "succeeded" | "failed";
        verdict?: AnswerVerdict;
        error?: string;
      }
    > = [];

    for (const job of jobs) {
      try {
        const result = await enrichJob(job);
        await rpc("complete_word_validation_enrichment", {
          p_confidence: result.confidence,
          p_failure_reason: result.failureReason ?? null,
          p_job_id: job.id,
          p_source: result.source,
          p_source_ref: result.sourceRef ?? null,
          p_verdict: result.verdict,
        });
        await recordEvent(rpc, job, result.source, true, result);
        results.push({
          id: job.id,
          status: "succeeded",
          verdict: result.verdict,
        });
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : "Unknown enrichment failure";
        await rpc("fail_word_validation_enrichment", {
          p_error: message,
          p_job_id: job.id,
        });
        await recordEvent(
          rpc,
          job,
          "background_enrichment",
          false,
          undefined,
          error,
        );
        results.push({ error: message, id: job.id, status: "failed" });
      }
    }

    return jsonResponse({ processed: results.length, results });
  };
}

if (import.meta.main) {
  Deno.serve(createHandler());
}
