const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../assets/js/ai-client.js'), 'utf8');
function client(fetch) {
  const context = { window: {}, fetch, URL, TextEncoder, TextDecoder, Error };
  vm.runInNewContext(source, context);
  return context.window.FlowSketchAIClient;
}
const config = { apiUrl: 'https://api.example/v1', key: 'secret-key', model: 'model', stream: false, mode: 'text' };
function request(api, overrides = {}) { return api.complete({ config: { ...config, ...overrides.config }, messages: [], ...overrides }); }
function wire(content = '你好', finish = 'stop', toolCalls) {
  return { choices: [{ message: { role: 'assistant', content, ...(toolCalls ? { tool_calls: toolCalls } : {}) }, finish_reason: finish }] };
}
function json(value) { return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } }); }
function event(delta, reason = null) { return 'data: ' + JSON.stringify({ choices: [{ index: 0, delta, finish_reason: reason }] }) + '\r\n\r\n'; }
function stream(text, sizes = [1]) {
  const bytes = new TextEncoder().encode(text);
  let position = 0, count = 0;
  return new Response(new ReadableStream({ pull(controller) {
    if (position === bytes.length) return controller.close();
    const next = Math.min(bytes.length, position + sizes[count++ % sizes.length]);
    controller.enqueue(bytes.slice(position, next)); position = next;
  } }), { headers: { 'Content-Type': 'text/event-stream' } });
}
function streamRequest(api, options = {}) { return api.complete({ config: { ...config, stream: true }, messages: [], ...options }); }
function plain(value) { return JSON.parse(JSON.stringify(value)); }

test('endpoint normalization and prohibited components', () => {
  const api = client();
  for (const [input, expected] of [
    ['https://api.example', 'https://api.example/v1/chat/completions'],
    ['https://api.example/', 'https://api.example/v1/chat/completions'],
    ['http://localhost:8000/v1/', 'http://localhost:8000/v1/chat/completions'],
    ['https://api.example/custom', 'https://api.example/custom/chat/completions'],
    ['https://api.example/v1/chat/completions/', 'https://api.example/v1/chat/completions'],
  ]) assert.equal(api.endpoint(input), expected);
  for (const input of ['no-url', 'file:///a', 'https://u:p@host', 'https://host/?key=secret', 'https://host/#secret', 'https://host/?', 'https://host/#']) assert.throws(() => api.endpoint(input));
});

test('JSON result and safe fetch options, tool mode gated', async () => {
  const seen = [];
  const api = client(async (url, options) => { seen.push({ url, ...options }); return json(wire()); });
  assert.deepEqual(plain(await request(api)), { role: 'assistant', content: '你好' });
  assert.equal(seen[0].credentials, 'omit');
  assert.equal(seen[0].referrerPolicy, 'no-referrer');
  assert.equal(seen[0].redirect, 'error');
  assert.equal(seen[0].headers.Authorization, 'Bearer secret-key');
  assert.equal(JSON.parse(seen[0].body).stream, false);
  assert.equal('tools' in JSON.parse(seen[0].body), false);
  const tools = [{ type: 'function', function: { name: 'draw' } }];
  await api.complete({ config: { ...config, mode: 'tools', key: '' }, messages: [], tools });
  assert.deepEqual(JSON.parse(seen[1].body).tools, tools);
  assert.equal(JSON.parse(seen[1].body).tool_choice, 'auto');
  assert.equal('Authorization' in seen[1].headers, false);
});

test('JSON tool response and no wire metadata', async () => {
  const calls = [{ id: 'call_a', type: 'function', function: { name: 'draw', arguments: '{"x":1}' } }];
  const api = client(async () => json(wire(null, 'tool_calls', calls)));
  assert.deepEqual(plain(await request(api)), { role: 'assistant', content: null, tool_calls: calls });
});

test('SSE UTF-8 split bytes, CRLF split, multi data lines, usage and content callbacks', async () => {
  const first = 'data: {"choices":\r\ndata: [{"index":0,"delta":{"role":"assistant","content":"你好"},"finish_reason":null}]}\r\n\r\n';
  const payload = ': keepalive\r\n\r\n' + first + event({ content: '世界' }) + event({}, 'stop') + 'data: {"choices":[],"usage":{"total_tokens":9}}\r\n\r\ndata: [DONE]\r\n\r\n';
  const deltas = [];
  const result = await streamRequest(client(async () => stream(payload, [1, 2, 3, 7])), { onDelta: (part, full) => deltas.push([part, full]) });
  assert.deepEqual(plain(result), { role: 'assistant', content: '你好世界' });
  assert.deepEqual(deltas, [['你好', '你好'], ['世界', '你好世界']]);
});

test('SSE indexed tool fragments aggregate in index order and only content calls back', async () => {
  const payload = event({ role: 'assistant', tool_calls: [{ index: 1, id: 'call_b', type: 'function', function: { name: 'mov', arguments: '{' } }, { index: 0, id: 'call_a', type: 'function', function: { name: 'dr', arguments: '{"x":' } }] })
    + event({ tool_calls: [{ index: 0, function: { name: 'aw', arguments: '1}' } }, { index: 1, function: { name: 'e', arguments: '}' } }] })
    + event({}, 'tool_calls') + 'data: [DONE]\n\n';
  const deltas = [];
  const result = await streamRequest(client(async () => stream(payload)), { onDelta: (...args) => deltas.push(args) });
  assert.deepEqual(plain(result), { role: 'assistant', content: null, tool_calls: [
    { id: 'call_a', type: 'function', function: { name: 'draw', arguments: '{"x":1}' } },
    { id: 'call_b', type: 'function', function: { name: 'move', arguments: '{}' } },
  ] });
  assert.deepEqual(deltas, []);
});

test('rejects truncated SSE, errors and malformed protocol', async () => {
  for (const payload of [event({ content: 'partial' }), event({}, 'stop'), event({}) + 'data: [DONE]\n\n',
    'data: {"error":{"message":"secret-key"}}\n\n', 'event: error\ndata: {}\n\n', 'data: invalid\n\n',
    event({}, 'length') + 'data: [DONE]\n\n', event({}, 'content_filter') + 'data: [DONE]\n\n',
    event({ tool_calls: [{ index: 0, function: { name: 'draw', arguments: '{}' } }] }, 'tool_calls') + 'data: [DONE]\n\n',
    event({ tool_calls: [{ index: 100 }] }), event({}, 'stop') + 'data: [DONE]\n\ndata: {}\n\n',
  ]) await assert.rejects(streamRequest(client(async () => stream(payload))), (error) => !error.message.includes('secret-key'));
});

test('rejects malformed JSON and interrupted completion reasons', async () => {
  for (const payload of [wire('partial', 'length'), wire('hidden', 'content_filter'), wire('partial', null), { error: { message: 'secret-key' } }, {}, wire([], 'stop'), wire(null, 'tool_calls', [])]) {
    await assert.rejects(request(client(async () => json(payload))), (error) => !error.message.includes('secret-key'));
  }
});

test('HTTP and network failures never echo credentials', async () => {
  for (const status of [401, 403, 404, 429, 500]) {
    await assert.rejects(request(client(async () => new Response('secret-key', { status }))), (error) => error.message.includes(String(status)) && !error.message.includes('secret-key'));
  }
  await assert.rejects(request(client(async () => { throw new Error('API secret-key connection error'); })), (error) => !error.message.includes('secret-key'));
});

test('abort signal forwarded and cancellation has safe message', async () => {
  const controller = new AbortController(); controller.abort();
  const api = client(async (_, options) => { assert.equal(options.signal, controller.signal); throw new DOMException('secret-key', 'AbortError'); });
  await assert.rejects(request(api, { signal: controller.signal }), /已取消或超时/);
});

test('response and tool argument size limits', async () => {
  await assert.rejects(request(client(async () => json(wire('x'.repeat(2 * 1024 * 1024))))), /2MB/);
  const calls = [{ id: 'a', type: 'function', function: { name: 'draw', arguments: 'x'.repeat(1024 * 1024 + 1) } }];
  await assert.rejects(request(client(async () => json(wire(null, 'tool_calls', calls)))), /1MB/);
  const payload = event({ tool_calls: [{ index: 0, id: 'a', function: { name: 'draw', arguments: 'x'.repeat(1024 * 1024 + 1) } }] }, 'tool_calls');
  await assert.rejects(streamRequest(client(async () => stream(payload, [65536]))), /1MB/);
});


test('invalid UTF-8 is rejected and incomplete indexed calls are rejected', async () => {
  const response = () => new Response(new Uint8Array([0xff, 0xfe]));
  await assert.rejects(streamRequest(client(async () => response())), /UTF-8/);
  await assert.rejects(request(client(async () => response())), /UTF-8/);
  const payload = event({ tool_calls: [{ index: 1, id: 'a', function: { name: 'draw', arguments: '{}' } }] }, 'tool_calls') + 'data: [DONE]\n\n';
  await assert.rejects(streamRequest(client(async () => stream(payload))), /序号不完整/);
  const calls = Array.from({ length: 101 }, (_, i) => ({ id: 'a' + i, type: 'function', function: { name: 'draw', arguments: '{}' } }));
  await assert.rejects(request(client(async () => json(wire(null, 'tool_calls', calls)))), /数量超过限制/);
});
