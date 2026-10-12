'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Execute the shipped editor bridge, with the surrounding editor represented by
// controlled native-function mocks. The engine itself has separate tests.
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const bridgeStart = html.indexOf('  const activateRecordBeforeAI=activateRecord;');
assert.ok(bridgeStart >= 0, 'index.html must contain the AI bridge');
const bridgeEnd = html.indexOf('\n})();', bridgeStart);
assert.ok(bridgeEnd > bridgeStart, 'AI bridge must end inside the editor closure');
const bridgeSource = html.slice(bridgeStart, bridgeEnd);

function harness(overrides = {}) {
  const calls = [];
  const events = [];
  const initialProject = { name: 'Diagram', canvas: { width: 800 }, elements: [{ id: 'one' }] };
  const context = {
    project: initialProject,
    selection: ['one'],
    activeFileId: 'A',
    aiFileEpoch: 0,
    aiFileTransitions: 0,
    previewMode: false,
    projectUrl: '',
    interaction: null,
    document: {
      body: { dataset: { projectLoaded: '1' } },
      dispatchEvent: event => events.push(event),
    },
    Event: class Event { constructor(type) { this.type = type; } },
    CustomEvent: class CustomEvent { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    canvas: { querySelector: () => null },
    $: selector => {
      assert.equal(selector, '#modal');
      return { classList: { contains: () => false } };
    },
    clone: structuredClone,
    activateRecord: record => {
      context.activeFileId = record.id;
      context.project = record.project;
      return record.id;
    },
    loadProjectFile: async () => {},
    createNewProjectFile: async () => {},
    importProjectFiles: async () => {},
    normalize: () => calls.push('normalize'),
    normalizeExtra: () => calls.push('normalizeExtra'),
    syncUI: () => calls.push('syncUI'),
    render: () => calls.push('render'),
    commit: () => calls.push('commit'),
    fitCanvas: () => calls.push('fit'),
    window: {
      FlowSketchAIEngine: {
        apply: (project, operations) => {
          calls.push('engine.apply');
          assert.equal(project, context.project);
          assert.equal(operations, edits);
          return { ...structuredClone(project), name: 'Edited' };
        },
        describe: project => { calls.push('engine.describe'); return project.name; },
      },
    },
    ...overrides,
  };
  vm.createContext(context);
  vm.runInContext(bridgeSource, context, { filename: 'index.html:AI-bridge' });
  return { context, editor: context.window.FlowSketchEditor, calls, events, initialProject };
}
const edits = [{ op: 'test-operation' }];

for (const [name, overrides] of [
  ['preview mode', { previewMode: true }],
  ['URL preview', { projectUrl: 'https://example.test/project.json' }],
  ['startup', { document: { body: { dataset: {} }, dispatchEvent() {} } }],
  ['in-flight transition', { aiFileTransitions: 1 }],
]) {
  test(`${name} refuses editing before the engine runs`, () => {
    const { editor, calls, context, initialProject } = harness(overrides);
    assert.throws(() => editor.assertEditable(), /只读|载入或切换/);
    assert.throws(() => editor.apply(edits, editor.fingerprint()), /只读|载入或切换/);
    assert.deepEqual(calls, []);
    assert.equal(context.project, initialProject);
  });
}

test('identical content in different files has different fingerprints', () => {
  const { context, editor, initialProject, events } = harness();
  const original = editor.fingerprint();
  assert.equal(context.activateRecord({ id: 'B', project: structuredClone(initialProject) }), 'B');
  assert.notEqual(editor.fingerprint(), original);
  assert.equal(JSON.parse(editor.fingerprint()).fileId, 'B');
  assert.equal(events[0].type, 'flowsketch:document-change');
  assert.equal(events[0].detail.fileId, 'B');
  // File identity remains part of the fingerprint independently of the epoch.
  context.aiFileEpoch = 0;
  assert.notEqual(editor.fingerprint(), original);
});

test('A -> B -> A invalidates an old fingerprint even when content is unchanged', () => {
  const { context, editor, initialProject, calls } = harness();
  const stale = editor.fingerprint();
  context.activateRecord({ id: 'B', project: structuredClone(initialProject) });
  context.activateRecord({ id: 'A', project: initialProject });
  assert.notEqual(editor.fingerprint(), stale);
  assert.throws(() => editor.apply(edits, stale), /当前文件或画布已变化/);
  assert.deepEqual(calls, []);
});

for (const operation of ['loadProjectFile', 'createNewProjectFile', 'importProjectFiles']) {
  for (const fails of [false, true]) {
    test(`${operation} blocks apply while awaiting and releases its guard after ${fails ? 'failure' : 'success'}`, async () => {
      let resolve, reject;
      const waiting = new Promise((res, rej) => { resolve = res; reject = rej; });
      let received;
      const { context, editor, calls, events } = harness({
        [operation]: (...args) => { received = args; return waiting; },
      });
      const stale = editor.fingerprint();
      const pending = context[operation]('file', 42);
      const settled = fails ? assert.rejects(pending, /load failed/) : pending;
      assert.deepEqual(received, ['file', 42]);
      assert.equal(context.aiFileTransitions, 1);
      assert.equal(events[0].type, 'flowsketch:document-transition');
      assert.throws(() => editor.apply(edits, editor.fingerprint()), /载入或切换/);
      assert.deepEqual(calls, []);
      if (fails) reject(new Error('load failed'));
      else resolve('loaded');
      assert.equal(await settled, fails ? undefined : 'loaded');
      assert.equal(context.aiFileTransitions, 0);
      assert.doesNotThrow(() => editor.assertEditable());
      assert.throws(() => editor.apply(edits, stale), /当前文件或画布已变化/);
      assert.equal(editor.apply(edits, editor.fingerprint()), 'Edited');
      assert.ok(calls.includes('commit'));
    });
  }
}

test('valid apply normalizes, renders, clears selection and commits exactly once', () => {
  const { context, editor, calls, initialProject } = harness();
  assert.equal(editor.apply(edits, editor.fingerprint()), 'Edited');
  assert.deepEqual(calls, ['engine.apply', 'normalize', 'normalizeExtra', 'syncUI', 'render', 'commit', 'engine.describe']);
  assert.notEqual(context.project, initialProject);
  assert.equal(initialProject.name, 'Diagram');
  assert.equal(context.project.name, 'Edited');
  assert.equal(context.selection.length, 0);
});

test('render failure restores the original project and selection without committing', () => {
  const { context, editor, calls, initialProject } = harness();
  const failure = new Error('render failed');
  let renders = 0;
  context.render = () => {
    calls.push('render');
    if (++renders === 1) throw failure;
    assert.equal(context.project, initialProject, 'rollback render must receive the original project');
    assert.deepEqual(Array.from(context.selection), ['one']);
  };
  assert.throws(() => editor.apply(edits, editor.fingerprint()), error => error === failure);
  assert.equal(context.project, initialProject);
  assert.deepEqual(Array.from(context.selection), ['one']);
  assert.deepEqual(calls, ['engine.apply', 'normalize', 'normalizeExtra', 'syncUI', 'render', 'syncUI', 'render']);
});
