// Offline inspection of Metro module factories: never run the app entry point.
// Usage: node verify-staging-bundle.cjs <bundle.js> <secure-env.json> <full-sha>
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');

function verify(bundlePath, envPath, expectedSha) {
  const env = JSON.parse(fs.readFileSync(envPath, 'utf8'));
  const pin = require('../staging-public-key.json');
  const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
  const check = (ok, label) => { if (!ok) throw new Error(label); };
  check(/^[a-f0-9]{40}$/.test(expectedSha), 'Expected full SHA required');
  check(env.EXPO_PUBLIC_SUPABASE_URL === pin.url && sha256(env.EXPO_PUBLIC_SUPABASE_ANON_KEY) === pin.sha256, 'Expected environment provenance mismatch');
  const source = fs.readFileSync(bundlePath, 'utf8');
  const ast = ts.createSourceFile('bundle.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const modules = new Map();
  const context = vm.createContext({ __d: (factory, id, deps) => modules.set(id, { factory, deps }) }, { codeGeneration: { strings: false, wasm: false } });
  // Register declarations only. No Metro startup, React Native startup, fetch,
  // sockets, global require, process object, or real Supabase client is available.
  for (const statement of ast.statements) {
    if (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression) &&
        statement.expression.expression.getText(ast) === '__d') {
      new vm.Script(statement.getText(ast)).runInContext(context, { timeout: 1000 });
    }
  }
  const find = predicate => {
    const matches = [...modules.entries()].filter(([, item]) => predicate(item.factory.toString()));
    check(matches.length === 1, 'Expected one matching compiled module');
    return matches[0];
  };
  const [clientId, client] = find(text => text.includes('supabaseAnonKey') && text.includes('.createClient)'));
  const [guardId, guard] = find(text => text.includes('Staging requires the approved project anonymous key.'));
  const [, metadata] = find(text => text.includes('buildIdentifier:') && text.includes('gitCommit:') && text.includes('environment:"staging"'));
  const invoke = (item, requireStub) => {
    const module = { exports: {} };
    item.factory(context, requireStub, () => { throw Error('Unexpected import'); }, () => { throw Error('Unexpected import'); }, module, module.exports, item.deps);
    return module.exports;
  };
  const guardExports = invoke(guard, () => { throw Error('Unexpected guard dependency'); });
  const calls = [];
  const clientExports = invoke(client, id => {
    if (id === guardId) return guardExports;
    // The verified source client has just three dependencies: URL polyfill,
    // supabase-js, and its staging guard. Stub all external effects.
    if (id === client.deps[0]) return {};
    if (id === client.deps[1]) return { createClient: (url, key, options) => { calls.push({ url, key, options }); return {}; } };
    throw Error('Unexpected client dependency');
  });
  check(calls.length === 1 && calls[0].url === pin.url && calls[0].key === env.EXPO_PUBLIC_SUPABASE_ANON_KEY, 'Compiled client selected incorrect backend');
  check(clientExports.supabaseUrl === pin.url && sha256(clientExports.supabaseAnonKey) === pin.sha256, 'Compiled exports mismatch');
  check(calls[0].options.auth.persistSession === false, 'Auth behavior changed');
  for (const [url, key] of [[undefined, env.EXPO_PUBLIC_SUPABASE_ANON_KEY], ['', env.EXPO_PUBLIC_SUPABASE_ANON_KEY], ['http://127.0.0.1:54321', env.EXPO_PUBLIC_SUPABASE_ANON_KEY], [pin.url, undefined], [pin.url, '']]) {
    let rejected = false;
    try { guardExports.assertStagingBackend('staging', url, key); } catch { rejected = true; }
    check(rejected, 'Compiled guard accepted invalid configuration');
  }
  const meta = invoke(metadata, () => { throw Error('Unexpected metadata dependency'); }).BUILD_METADATA;
  check(meta.environment === 'staging' && meta.gitCommit === expectedSha && meta.buildDate && meta.appVersion === '1.1.0', 'Compiled metadata stale or incorrect');
  // This is the protected Animalplace reference, not a network request.
  check(!source.includes('ecmkfqhbnpsioiyugiqz.supabase.co'), 'Animalplace URL found in emitted bundle');
  console.log(JSON.stringify({ status: 'PASS', clientModule: clientId, backend: pin.ref, keyProvenance: true, actualClientArgumentsVerified: true, compiledGuardNegativeCases: 5, environment: meta.environment, gitCommit: meta.gitCommit, networkRequests: 0 }));
}
try { verify(...process.argv.slice(2)); } catch (error) {
  // Never emit VM source excerpts, stack traces or environment values.
  console.error('FAIL: offline staging bundle verification did not pass.');
  process.exitCode = 1;
}
