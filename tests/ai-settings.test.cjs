'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../assets/js/ai.js'), 'utf8');
const storageKey = 'flowsketch-ai-settings-v1';

function element() {
  const listeners = new Map();
  const classes = new Set();
  let value = '';
  return {
    get value() { return value; }, set value(next) { value = String(next); },
    textContent: '', checked: false, disabled: false, hidden: false, open: true,
    children: [],
    classList: {
      add(name) { classes.add(name); }, remove(name) { classes.delete(name); },
      toggle(name, state) { if (state) classes.add(name); else classes.delete(name); },
    },
    addEventListener(type, handler) { listeners.set(type, handler); },
    emit(type, event = {}) { return listeners.get(type)?.({ preventDefault() {}, ...event }); },
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = nodes; },
    get lastElementChild() { return this.children.at(-1); },
    querySelectorAll() { return []; },
    setAttribute() {}, focus() {},
  };
}

function harness(saved, complete = async () => ({ content: '完成' })) {
  const nodes = new Map();
  const get = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  const stored = new Map(saved === undefined ? [] : [[storageKey, JSON.stringify(saved)]]);
  const timers = [], cleared = [], calls = [];
  const document = {
    getElementById: get, createElement: tag => tag === 'canvas' ? {
      getContext: () => ({ fillRect() {}, drawImage() {} }), toDataURL: () => 'data:image/jpeg;base64,test',
    } : element(),
    querySelector: () => element(), querySelectorAll: () => [], addEventListener() {},
  };
  const context = {
    document, AbortController, DOMException,
    FileReader: class { readAsDataURL() { this.result = 'data:image/png;base64,test'; this.onload(); } },
    Image: class { naturalWidth = 100; naturalHeight = 100; set src(value) { this.onload(); } },
    localStorage: {
      getItem: key => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key),
    },
    setTimeout: (callback, delay) => { const timer = { callback, delay }; timers.push(timer); return timer; },
    clearTimeout: timer => cleared.push(timer),
    window: {
      FlowSketchEditor: { readonly: false, assertEditable() {}, fingerprint: () => 'same', snapshot: () => ({}), apply: () => ({}), fit() {} },
      FlowSketchAIEngine: { describe: snapshot => snapshot },
      FlowSketchAIPrompts: { tool: () => ({}), instructions: () => 'instructions' },
      FlowSketchAIClient: { endpoint() {}, complete: options => { calls.push(options); return complete(options); } },
    },
  };
  vm.runInNewContext(source, context, { filename: 'assets/js/ai.js' });
  return {
    get, stored, timers, cleared, calls,
    send: (text = '画图') => { get('aiPrompt').value = text; return get('aiForm').emit('submit'); },
    input: value => { get('aiTimeout').value = value; get('aiTimeout').emit('input'); },
    history: value => { get('aiHistory').value = value; get('aiHistory').emit('input'); },
    addImage: async () => {
      get('aiImageInput').onchange({ target: { files: [{ type: 'image/png', size: 1, name: 'reference.png' }] } });
      await new Promise(resolve => setImmediate(resolve));
    },
    notices: () => get('aiMessages').children.map(node => node.children[1]?.textContent ?? '').join('\n'),
  };
}

const configured = { apiUrl: 'https://example.test/v1', model: 'test' };

test('new and legacy settings default to 180 seconds without losing existing fields', () => {
  assert.equal(harness().get('aiTimeout').value, '180');
  const h = harness({ ...configured, stream: false, mode: 'tools' });
  assert.equal(h.get('aiTimeout').value, '180');
  assert.equal(h.get('aiModel').value, 'test');
  assert.equal(h.get('aiStream').checked, false);
  assert.equal(h.get('aiMode').value, 'tools');
});

test('invalid historical values fall back to the default; valid boundaries survive reload', () => {
  for (const timeoutSeconds of [null, '', '60', 0, 9, 3601, 10.5]) {
    assert.equal(harness({ ...configured, timeoutSeconds }).get('aiTimeout').value, '180');
  }
  for (const timeoutSeconds of [10, 60, 3600]) {
    assert.equal(harness({ ...configured, timeoutSeconds }).get('aiTimeout').value, String(timeoutSeconds));
  }
});

test('valid input persists, save closes settings, and clear restores the default', () => {
  const h = harness(configured);
  h.input('45');
  assert.equal(JSON.parse(h.stored.get(storageKey)).timeoutSeconds, 45);
  h.get('aiSave').onclick();
  assert.equal(h.get('aiSettings').open, false);
  h.get('aiForget').onclick();
  assert.equal(h.get('aiTimeout').value, '180');
  assert.equal(h.stored.has(storageKey), false);
});

test('invalid edited input is rejected by both save and send without persisting or requesting', async () => {
  for (const invalid of ['', ' ', '0', '9', '3601', '15.2', 'NaN', 'Infinity']) {
    const h = harness({ ...configured, timeoutSeconds: 60 });
    h.get('aiSettings').open = true;
    h.input(invalid);
    h.get('aiSave').onclick();
    assert.equal(h.get('aiSettings').open, true);
    assert.match(h.get('aiSettingsStatus').textContent, /10–3600 秒之间的整数/);
    await h.send();
    assert.equal(h.calls.length, 0);
    assert.equal(h.timers.length, 0);
    assert.equal(JSON.parse(h.stored.get(storageKey)).timeoutSeconds, 60);
    assert.equal(h.get('aiPrompt').value, '画图');
  }
});

test('configured total deadline aborts the request and reports its seconds', async () => {
  const h = harness({ ...configured, timeoutSeconds: 27 }, ({ signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }));
  const pending = h.send();
  assert.equal(h.timers[0].delay, 27000);
  assert.equal(h.get('aiTimeout').disabled, true);
  assert.equal(h.get('aiHistory').disabled, true);
  h.timers[0].callback();
  await pending;
  assert.equal(h.calls[0].signal.aborted, true);
  assert.match(h.notices(), /请求超过 27 秒，已停止/);
  assert.deepEqual(h.cleared, [h.timers[0]]);
  assert.equal(h.get('aiTimeout').disabled, false);
});

test('all tool rounds share one deadline and the settings snapshot of this send', async () => {
  let release;
  const firstReply = new Promise(resolve => { release = resolve; });
  let round = 0;
  const h = harness({ ...configured, mode: 'tools', timeoutSeconds: 42 }, () => ++round === 1 ? firstReply : Promise.resolve({ content: '完成' }));
  const pending = h.send();
  assert.equal(h.get('aiTimeout').disabled, true);
  // Programmatic changes can still dispatch input while a native input is disabled.
  h.input('90');
  h.history('1');
  h.get('aiMode').value = 'json';
  h.get('aiMode').emit('input');
  release({ content: '', tool_calls: [{ id: 'edit-1', function: { name: 'edit_canvas', arguments: '{"operations":[]}' } }] });
  await pending;
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[0].config, h.calls[1].config);
  assert.equal(h.calls[1].config.timeoutSeconds, 42);
  assert.equal(h.calls[1].config.mode, 'tools');
  assert.equal(h.calls[1].config.historyTurns, 24);
  assert.equal(h.timers.length, 1);
  assert.equal(h.timers[0].delay, 42000);
  assert.deepEqual(h.cleared, [h.timers[0]]);
  assert.equal(h.get('aiTimeout').disabled, false);
  assert.equal(h.get('aiHistory').disabled, false);
});

test('history defaults and legacy migration use 24; only valid saved integers survive', () => {
  assert.equal(harness().get('aiHistory').value, '24');
  assert.equal(harness(configured).get('aiHistory').value, '24');
  for (const historyTurns of [null, '', '24', 0, 101, 2.5]) {
    assert.equal(harness({ ...configured, historyTurns }).get('aiHistory').value, '24');
  }
  for (const historyTurns of [1, 24, 100]) {
    assert.equal(harness({ ...configured, historyTurns }).get('aiHistory').value, String(historyTurns));
  }
});

test('history persists and clears; invalid input prevents save and send', async () => {
  const h = harness(configured);
  h.history('50');
  h.get('aiSave').onclick();
  assert.equal(JSON.parse(h.stored.get(storageKey)).historyTurns, 50);
  for (const value of ['', ' ', '0', '-1', '101', '2.1', 'NaN', 'Infinity']) {
    h.get('aiSettings').open = true;
    h.history(value);
    h.get('aiSave').onclick();
    assert.equal(h.get('aiSettings').open, true);
    assert.match(h.get('aiSettingsStatus').textContent, /1–100 之间的整数/);
    await h.send();
    assert.equal(h.calls.length, 0);
    assert.equal(JSON.parse(h.stored.get(storageKey)).historyTurns, 50);
  }
  h.get('aiForget').onclick();
  assert.equal(h.get('aiHistory').value, '24');
  assert.equal(h.stored.has(storageKey), false);
});

const userTexts = call => Array.from(call.messages).filter(message => message.role === 'user').map(message => message.content);

test('default sends 24 turns including current input; increasing restores retained history', async () => {
  const h = harness(configured);
  for (let n = 1; n <= 30; n++) await h.send(`turn-${n}`);
  assert.deepEqual(userTexts(h.calls.at(-1)), Array.from({ length: 24 }, (_, i) => `turn-${i + 7}`));
  h.history('1');
  await h.send('turn-31');
  assert.deepEqual(userTexts(h.calls.at(-1)), ['turn-31']);
  h.history('50');
  await h.send('turn-32');
  assert.deepEqual(userTexts(h.calls.at(-1)), Array.from({ length: 32 }, (_, i) => `turn-${i + 1}`));
});

test('memory slides at 100 turns even when the sending window is smaller', async () => {
  const h = harness({ ...configured, historyTurns: 1 });
  for (let n = 1; n <= 105; n++) await h.send(`turn-${n}`);
  h.history('100');
  await h.send('turn-106');
  assert.deepEqual(userTexts(h.calls.at(-1)), Array.from({ length: 100 }, (_, i) => `turn-${i + 7}`));
});

test('tool rounds stay inside their user turn and are pruned together at a one-turn window', async () => {
  let calls = 0;
  const h = harness({ ...configured, mode: 'tools', historyTurns: 2 }, async () => ++calls === 1 ? {
    content: '', tool_calls: [{ id: 'call-1', function: { name: 'edit_canvas', arguments: '{"operations":[]}' } }],
  } : { content: '完成' });
  await h.send('first');
  assert.deepEqual(userTexts(h.calls[1]), ['first']);
  assert.equal(h.calls[1].messages.filter(message => message.role === 'tool').length, 1);
  await h.send('second');
  assert.deepEqual(userTexts(h.calls[2]), ['first', 'second']);
  assert.equal(h.calls[2].messages.filter(message => message.role === 'tool').length, 1);
  h.history('1');
  await h.send('third');
  assert.deepEqual(userTexts(h.calls[3]), ['third']);
  assert.equal(h.calls[3].messages.filter(message => message.role === 'tool').length, 0);
});

test('image capability guard only checks history actually sent, including the one-turn edge', async () => {
  const h = harness({ ...configured, vision: true, historyTurns: 2 });
  await h.addImage();
  await h.send('with image');
  assert.equal(h.calls[0].messages.at(-1).content[1].type, 'image_url');
  h.get('aiVision').checked = false;
  h.get('aiVision').emit('input');
  await h.send('blocked');
  assert.equal(h.calls.length, 1);
  assert.match(h.notices(), /当前模型未启用图片输入/);
  h.history('1');
  await h.send('without history');
  assert.equal(h.calls.length, 2);
  assert.deepEqual(userTexts(h.calls[1]), ['without history']);
  h.history('2');
  await h.send('old image outside window');
  assert.equal(h.calls.length, 3);
  assert.deepEqual(userTexts(h.calls[2]), ['without history', 'old image outside window']);
  h.history('4');
  await h.send('image back in window');
  assert.equal(h.calls.length, 3);
});

test('manual stop cancels the configured deadline without a timeout message', async () => {
  const h = harness({ ...configured, timeoutSeconds: 60 }, ({ signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }));
  const pending = h.send();
  h.get('aiStop').onclick();
  await pending;
  assert.match(h.notices(), /已停止生成/);
  assert.doesNotMatch(h.notices(), /请求超过/);
  assert.deepEqual(h.cleared, [h.timers[0]]);
});
