(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  if(window.FlowSketchEditor.readonly) { $('aiBtn').hidden=true;$('aiPanel').hidden=true;return; }
  const storageKey = 'flowsketch-ai-settings-v1';
  const defaults = {apiUrl:'',key:'',model:'',vision:false,stream:true,mode:'json',timeoutSeconds:180,historyTurns:24};
  const validTimeout = value => Number.isInteger(value)&&value>=10&&value<=3600;
  const validHistory = value => Number.isInteger(value)&&value>=1&&value<=100;
  let config = {...defaults}, turns = [], attachments = [], controller = null, busy = false;
  let imageGeneration = 0, assetSequence = 0, stopReason = '';
  const assetRegistry = new Map();
  function pruneAssets() {
    const retained = new Set([...attachments.map(item=>item.assetId),...turns.flatMap(turn=>turn.assetIds||[])]);
    for(const id of assetRegistry.keys())if(!retained.has(id))assetRegistry.delete(id);
  }
  function resetAssets() {assetRegistry.clear();}
  function stopRequest(reason) {if(busy){stopReason=reason;controller?.abort();}}
  const settingsFields = ['aiUrl','aiKey','aiModel','aiVision','aiStream','aiMode','aiTimeout','aiHistory'];
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if(saved) config = {
      apiUrl:typeof saved.apiUrl==='string'?saved.apiUrl:'', key:typeof saved.key==='string'?saved.key:'',
      model:typeof saved.model==='string'?saved.model:'', vision:saved.vision===true,
      stream:saved.stream!==false,mode:saved.mode==='tools'?'tools':'json',
      timeoutSeconds:validTimeout(saved.timeoutSeconds)?saved.timeoutSeconds:defaults.timeoutSeconds,
      historyTurns:validHistory(saved.historyTurns)?saved.historyTurns:defaults.historyTurns
    };
  } catch { /* A blocked or empty local store still permits an in-memory session. */ }
  function fillSettings() {
    $('aiUrl').value=config.apiUrl; $('aiKey').value=config.key; $('aiModel').value=config.model;
    $('aiVision').checked=config.vision; $('aiStream').checked=config.stream; $('aiMode').value=config.mode;
    $('aiTimeout').value=config.timeoutSeconds;
    $('aiHistory').value=config.historyTurns;
    syncConfig();
  }
  function syncConfig() {
    $('aiModelBadge').textContent=config.model ? `${config.model} · ${config.vision?'文字 + 图片':'文字'}`:'配置后开始创作';
    $('aiAttach').disabled=busy||!config.vision;
    $('aiAttach').title=config.vision?'添加参考图片（最多 4 张）':'请先启用模型支持图片输入';
    if(!config.vision) {attachments=[];pruneAssets();imageGeneration++;renderAttachments();}
    $('aiPrompt').placeholder=config.vision?'描述想法，或添加参考图片…':'描述你的想法，AI 会直接修改画布…';
  }
  function readSettings() {
    const timeoutValue=$('aiTimeout').value.trim(),timeoutSeconds=Number(timeoutValue);
    if(!timeoutValue||!validTimeout(timeoutSeconds))throw Error('请求超时必须填写 10–3600 秒之间的整数。');
    const historyValue=$('aiHistory').value.trim(),historyTurns=Number(historyValue);
    if(!historyValue||!validHistory(historyTurns))throw Error('上下文轮数必须填写 1–100 之间的整数。');
    config={apiUrl:$('aiUrl').value.trim(),key:$('aiKey').value.trim(),model:$('aiModel').value.trim(),
      vision:$('aiVision').checked,stream:$('aiStream').checked,mode:$('aiMode').value,timeoutSeconds,historyTurns};
    syncConfig();
    try {localStorage.setItem(storageKey,JSON.stringify(config));$('aiConfigState').textContent='已存本机';$('aiSettingsStatus').textContent='';}
    catch {$('aiConfigState').textContent='本地存储不可用';$('aiSettingsStatus').textContent='浏览器不允许本地存储，配置仅在本次页面会话有效。';}
  }
  function validateConfig() {
    window.FlowSketchAIClient.endpoint(config.apiUrl);
    if(!config.model) throw Error('请先填写模型名。');
    if(config.model.length>200) throw Error('模型名过长，请检查。');
  }
  settingsFields.forEach(id => $(id).addEventListener('input',()=>{
    try{readSettings();}catch(e){$('aiSettingsStatus').textContent=e.message;}
  }));
  $('aiShowKey').onclick=()=>{
    const shown=$('aiKey').type==='password';$('aiKey').type=shown?'text':'password';
    $('aiShowKey').textContent=shown?'隐藏':'显示';$('aiShowKey').setAttribute('aria-label',shown?'隐藏 API Key':'显示 API Key');
  };
  $('aiSave').onclick=()=>{try{readSettings();validateConfig();$('aiSettings').open=false;}catch(e){$('aiSettingsStatus').textContent=e.message;}};
  $('aiForget').onclick=()=>{
    config={...defaults};fillSettings();$('aiKey').type='password';$('aiShowKey').textContent='显示';
    turns=[];attachments=[];resetAssets();imageGeneration++;renderAttachments();
    try{localStorage.removeItem(storageKey);$('aiConfigState').textContent='仅存本机';$('aiSettingsStatus').textContent='本浏览器中的 API 配置已清除。';}
    catch{$('aiSettingsStatus').textContent='配置已在当前页面清除；浏览器阻止了本地存储访问。';}
  };
  function togglePanel(open) {
    $('aiPanel').hidden=!open;document.querySelector('.workspace').classList.toggle('ai-open',open);
    $('aiBtn').classList.toggle('active',open);$('aiBtn').setAttribute('aria-expanded',String(open));
    if(open){if(!config.apiUrl||!config.model)$('aiSettings').open=true;else $('aiPrompt').focus();}
    else {resetDrag();$('aiBtn').focus();}
    window.dispatchEvent(new Event('resize'));
  }
  $('aiBtn').onclick=()=>togglePanel($('aiPanel').hidden);
  $('aiClose').onclick=()=>togglePanel(false);
  // Keyboard shortcuts inside the chat must never delete or nudge canvas elements.
  $('aiPanel').addEventListener('keydown',event=>{
    event.stopPropagation();
    if(event.key==='Escape'&&!busy)togglePanel(false);
  });
  function setBusy(value) {
    busy=value;$('aiSend').hidden=value;$('aiStop').hidden=!value;
    $('aiPrompt').disabled=value;$('aiClear').disabled=value;
    [...settingsFields,'aiSave','aiForget'].forEach(id=>$(id).disabled=value);
    syncConfig();
    if(!value)$('aiPrompt').focus();
  }
  function scrollChat() {
    const log=$('aiMessages');log.scrollTop=log.scrollHeight;
  }
  function message(role,text='',images=[]) {
    $('aiWelcome').hidden=true;
    const node=document.createElement('div');node.className='ai-message '+role;
    const label=document.createElement('div');label.className='ai-message-label';
    label.textContent=role==='user'?'你':role==='assistant'?'✦ AI 助手':'画布';node.append(label);
    if(images.length){const list=document.createElement('div');list.className='ai-message-images';images.forEach(item=>{
      const img=document.createElement('img');img.src=item.url;img.alt=item.name;list.append(img);
    });node.append(list);}
    const body=document.createElement('div');body.className='ai-message-body';body.textContent=text;node.append(body);
    $('aiMessages').append(node);scrollChat();return {node,body};
  }
  function notice(text,error=false){const result=message('notice',text);result.node.classList.toggle('error',error);return result;}
  document.querySelectorAll('[data-ai-prompt]').forEach(button=>button.onclick=()=>{
    $('aiPrompt').value=button.dataset.aiPrompt;$('aiPrompt').focus();
  });
  $('aiClear').onclick=()=>{
    if(busy)return;turns=[];attachments=[];resetAssets();imageGeneration++;renderAttachments();
    $('aiMessages').querySelectorAll('.ai-message').forEach(node=>node.remove());$('aiWelcome').hidden=false;
    $('aiStatus').textContent='新对话 · 保留当前画布';$('aiPrompt').value='';
  };
  document.addEventListener('flowsketch:document-transition',()=>{
    stopRequest('document');
  });
  document.addEventListener('flowsketch:document-change',()=>{
    const hadConversation=turns.length>0;
    stopRequest('document');
    turns=[];attachments=[];resetAssets();imageGeneration++;renderAttachments();
    if(hadConversation)notice('已切换当前文件，后续对话会使用新文件的画布。');
  });
  function renderAttachments() {
    $('aiAttachments').replaceChildren();attachments.forEach((item,index)=>{
      const node=document.createElement('div');node.className='ai-attachment';
      const img=document.createElement('img');img.src=item.url;img.alt=item.name;
      const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.disabled=busy;
      remove.setAttribute('aria-label',`移除 ${item.name}`);remove.onclick=()=>{attachments.splice(index,1);pruneAssets();renderAttachments();};
      node.append(img,remove);$('aiAttachments').append(node);
    });
  }
  async function prepareImage(file) {
    if(!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type))throw Error('只支持 PNG、JPEG、WebP 和 GIF 图片。');
    if(file.size>8*1024*1024)throw Error('单张图片不能超过 8 MB。');
    const url=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('图片读取失败。'));reader.readAsDataURL(file);});
    const image=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(Error('无法解码图片，请换一张。'));img.src=url;});
    const scale=Math.min(1,1600/Math.max(image.naturalWidth,image.naturalHeight));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
    const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
    return {assetId:`ref_${++assetSequence}`,name:file.name.slice(0,200),url:canvas.toDataURL('image/jpeg',.88),width:canvas.width,height:canvas.height};
  }
  async function addImages(files) {
    if(!config.vision||busy)return;
    const generation=imageGeneration;
    for(const file of files){
      if(attachments.length>=4){notice('每条消息最多附加 4 张图片。',true);break;}
      try{const item=await prepareImage(file);if(generation!==imageGeneration||!config.vision||busy)return;attachments.push(item);assetRegistry.set(item.assetId,{src:item.url,name:item.name,width:item.width,height:item.height});renderAttachments();}
      catch(e){notice(e.message,true);}
    }
  }
  // Consume every panel drop, including disabled/unsupported inputs, before the canvas sees it.
  let dragDepth=0;
  const dropHint=document.createElement('div');dropHint.className='ai-drop-hint';dropHint.hidden=true;
  dropHint.setAttribute('role','status');$('aiPanel').append(dropHint);
  function resetDrag() {dragDepth=0;dropHint.hidden=true;$('aiPanel').classList.remove('ai-dragging');}
  function dragFeedback() {
    dropHint.textContent=busy?'正在生成，请完成或停止后添加图片。':!config.vision?'请先启用「模型支持图片输入」，图片将作为聊天附件。':'松开添加参考图片 · 仅支持图片，不会直接加入画布';
    dropHint.hidden=false;$('aiPanel').classList.add('ai-dragging');
  }
  for(const type of ['dragenter','dragover','dragleave','drop'])$('aiPanel').addEventListener(type,event=>{
    event.preventDefault();event.stopPropagation();
    if(type==='dragenter'){dragDepth++;dragFeedback();}
    else if(type==='dragover'){dragFeedback();if(event.dataTransfer)event.dataTransfer.dropEffect=busy||!config.vision?'none':'copy';}
    else if(type==='dragleave'){dragDepth=Math.max(0,dragDepth-1);if(!dragDepth)resetDrag();}
    else {
      resetDrag();
      if(busy){notice('正在生成，请完成或停止后添加图片。',true);return;}
      if(!config.vision){notice('请先启用「模型支持图片输入」，再添加聊天参考图片。',true);return;}
      const files=[...(event.dataTransfer?.files||[])];
      if(!files.length){notice('请拖入 PNG、JPEG、WebP 或 GIF 图片文件。',true);return;}
      addImages(files);
    }
  });
  $('aiAttach').onclick=()=>{if(config.vision&&!busy)$('aiImageInput').click();};
  $('aiImageInput').onchange=event=>{addImages([...event.target.files]);event.target.value='';};
  $('aiPrompt').addEventListener('paste',event=>{
    const files=[...event.clipboardData.items].filter(item=>item.kind==='file'&&item.type.startsWith('image/')).map(item=>item.getAsFile()).filter(Boolean);
    if(files.length&&config.vision){event.preventDefault();addImages(files);}
  });
  $('aiPrompt').addEventListener('keydown',event=>{
    if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();$('aiForm').requestSubmit();}
  });
  const tool = window.FlowSketchAIPrompts.tool();
  function instructions(snapshot,mode,referenceImages) {
    return window.FlowSketchAIPrompts.instructions(snapshot,mode,referenceImages);
  }
  function displayText(text) {return String(text||'').replace(/```flowsketch\s*[\s\S]*?(?:```|$)/g,'\n正在准备画布修改…\n');}
  function parseEdits(text) {
    const matches=[...String(text||'').matchAll(/```flowsketch\s*([\s\S]*?)```/g)];
    if(!matches.length){if(String(text||'').includes('```flowsketch'))throw Error('AI 的编辑指令不完整，未修改画布。');return null;}
    if(matches.length!==1)throw Error('AI 返回了多个修改批次，请重新发送。');
    const parsed=JSON.parse(matches[0][1]);
    if(!parsed||!Array.isArray(parsed.operations))throw Error('AI 的编辑指令格式错误，未修改画布。');
    return parsed.operations;
  }
  $('aiStop').onclick=()=>stopRequest('user');
  async function send(event) {
    event.preventDefault();if(busy)return;
    try{readSettings();window.FlowSketchEditor.assertEditable();validateConfig();}catch(e){$('aiSettings').open=true;$('aiSettingsStatus').textContent=e.message;return;}
    const text=$('aiPrompt').value.trim(),images=attachments.slice();if(!text&&!images.length)return;
    const requestConfig={...config};
    const priorTurns=requestConfig.historyTurns>1?turns.slice(-(requestConfig.historyTurns-1)):[];
    if(!requestConfig.vision&&priorTurns.some(turn=>turn.some(m=>Array.isArray(m.content)&&m.content.some(part=>part.type==='image_url')))){
      notice('当前模型未启用图片输入，请开启图片能力，或点击「新对话」开始纯文字会话。',true);return;
    }
    const content=images.length?[{type:'text',text:(text||'请根据这张参考图绘制或修改画布。')+'\n参考图片（依次对应后面的 image_url）：'+images.map(item=>`${item.assetId} · ${item.name} · ${item.width}×${item.height}`).join('；')},...images.map(item=>({type:'image_url',image_url:{url:item.url}}))]:text;
    const turn=[{role:'user',content}];turn.assetIds=images.map(item=>item.assetId);turns.push(turn);if(turns.length>100)turns.shift();
    const requestTurns=[...priorTurns,turn];
    const referenceIds=[...new Set(requestTurns.flatMap(item=>item.assetIds||[]))];
    const assetMap=Object.fromEntries(referenceIds.filter(id=>assetRegistry.has(id)).map(id=>[id,assetRegistry.get(id)]));
    const referenceImages=Object.entries(assetMap).map(([id,{name,width,height}])=>({assetId:id,name:name.slice(0,200),width,height}));
    message('user',text,images);$('aiPrompt').value='';attachments=[];imageGeneration++;pruneAssets();renderAttachments();
    setBusy(true);controller=new AbortController();const signal=controller.signal;
    stopReason='';
    let timedOut=false,applied=0,failedBatches=0,expected=window.FlowSketchEditor.fingerprint();
    const timer=setTimeout(()=>{timedOut=true;controller?.abort();},requestConfig.timeoutSeconds*1000);
    const startedAt=Date.now();let phase='正在连接模型…';
    function updateStatus(value) {if(value)phase=value;$('aiStatus').textContent=`${phase} · 已用 ${Math.floor((Date.now()-startedAt)/1000)} 秒 / 上限 ${requestConfig.timeoutSeconds} 秒`;}
    updateStatus();const ticker=setInterval(()=>updateStatus(),1000);
    let pending=null;
    try {
      for(let round=0;round<8;round++) {
        if(signal.aborted)throw new DOMException('Aborted','AbortError');
        pending=message('assistant','正在思考…');pending.node.classList.add('pending');
        const snapshot=window.FlowSketchAIEngine.describe(window.FlowSketchEditor.snapshot());
        const reply=await window.FlowSketchAIClient.complete({config:requestConfig,
          messages:[{role:'system',content:instructions(snapshot,requestConfig.mode,referenceImages)},...requestTurns.flat()],
          tools:[tool],signal,onDelta:(_delta,full)=>{pending.body.textContent=displayText(full)||'正在准备画布修改…';updateStatus(applied?`已应用 ${applied} 批修改 · AI 正在回复…`:'AI 正在回复…');scrollChat();}});
        if(signal.aborted)throw new DOMException('Aborted','AbortError');
        pending.node.classList.remove('pending');pending.body.textContent=displayText(reply.content)||'正在准备画布修改…';
        if(reply.tool_calls?.length) {
          if(requestConfig.mode!=='tools')throw Error('接口返回了未启用的工具调用，请切换修改方式。');
          const ops=reply.tool_calls.flatMap(call=>{
            if(call.function.name!=='edit_canvas')throw Error('AI 请求了不支持的工具。');
            const args=JSON.parse(call.function.arguments);if(!Array.isArray(args.operations))throw Error('AI 工具参数缺少 operations。');return args.operations;
          });
          let result;
          try{
            result=window.FlowSketchEditor.apply(ops,expected,{assetMap});expected=window.FlowSketchEditor.fingerprint();applied++;
            notice(`✓ 已应用 ${ops.length} 项修改 · 可使用顶部撤销`);
            if(applied===1)window.FlowSketchEditor.fit();
          }catch(e){
            if(window.FlowSketchEditor.fingerprint()!==expected)throw e;
            failedBatches++;result={error:e.message};notice(e.message,true);
          }
          turn.push(reply,...reply.tool_calls.map(call=>({role:'tool',tool_call_id:call.id,content:JSON.stringify(result)})));
          if(!reply.content)pending.body.textContent=result.error?'修改未应用，正在修正指令…':'画布已更新。';
          updateStatus(result.error?`本批修改未应用${applied?` · 已应用 ${applied} 批`:''} · 正在修正…`:`已应用 ${applied} 批修改 · 正在整理回复…`);pending=null;continue;
        }
        const ops=requestConfig.mode==='json'?parseEdits(reply.content):null;
        if(ops){
          window.FlowSketchEditor.apply(ops,expected,{assetMap});expected=window.FlowSketchEditor.fingerprint();applied++;
          pending.body.textContent=String(reply.content).replace(/```flowsketch\s*[\s\S]*?```/g,'').trim()||'画布已更新。';
          notice(`✓ 已应用 ${ops.length} 项修改 · 可使用顶部撤销`);window.FlowSketchEditor.fit();
        }else if(!reply.content)throw Error('接口没有返回文字或编辑指令，请检查模型配置。');
        turn.push(reply);$('aiStatus').textContent=applied?`已应用 ${applied} 批修改${failedBatches?' · 曾有修改未应用，请核对回复':''}`:failedBatches?'回复完成 · 修改未应用':'回复完成';pending=null;return;
      }
      notice('已达到本轮修改次数上限。已应用的修改已保留，可以继续对话。');$('aiStatus').textContent='本轮结束';
    }catch(e){
      if(pending){pending.node.classList.remove('pending');if(pending.body.textContent==='正在思考…')pending.body.textContent='回复中断。';}
      const interrupted=/连接失败|流意外中断|缺少结束标记|Failed to fetch|network/i.test(e.message||'');
      const detail=timedOut?`请求超过 ${requestConfig.timeoutSeconds} 秒，已停止。`:signal.aborted?(stopReason==='document'?'已切换文件，停止当前生成。':'已停止生成。'):e instanceof SyntaxError?'AI 返回的编辑 JSON 无法解析，未应用本批修改。':interrupted?`${e.message} 页面总时限为 ${requestConfig.timeoutSeconds} 秒；也可检查上游或 Nginx 的 proxy_read_timeout，当前信息无法确定中断原因。`:e.message;
      notice(detail+(applied?' 已完成的修改仍保留，可撤销。':''),!signal.aborted);
      $('aiStatus').textContent=timedOut?'已达请求总时限':signal.aborted?(stopReason==='document'?'文件切换 · 已停止':'已停止'):interrupted?'连接或上游回复中断':'请求失败';
      if(stopReason==='document')return;
      const retry=document.createElement('button');retry.className='btn';retry.textContent='重新发送这条消息';
      retry.onclick=()=>{if(busy)return;$('aiPrompt').value=text;attachments=config.vision?images.slice():[];for(const item of attachments)assetRegistry.set(item.assetId,{src:item.url,name:item.name,width:item.width,height:item.height});pruneAssets();renderAttachments();$('aiPrompt').focus();};
      $('aiMessages').lastElementChild.append(retry);scrollChat();
    }finally{clearTimeout(timer);clearInterval(ticker);controller=null;resetDrag();setBusy(false);}
  }
  $('aiForm').addEventListener('submit',send);
  fillSettings();if(config.apiUrl&&config.model)$('aiSettings').open=false;
})();
