/* ============================================================
   worksheets.js — מחולל דפי עבודה (RTL, A4)
   תפריט ראשי + תצוגת דף חיה במחולל + תצוגה מקדימה + הורדה מידית PDF עם בס"ד
   Canvas → jsPDF (image) כדי לשמור עברית מושלמת בלי צורך בפונט מוטמע.
   ============================================================ */
(function () {
  'use strict';

  const STORAGE_KEY = 'ws_state_v1';

  const TEMPLATES = [
    { id: 'math-add',      name: 'חיבור',          desc: 'תרגילי חיבור',              icon: '➕', cat: 'חשבון' },
    { id: 'math-sub',      name: 'חיסור',          desc: 'תרגילי חיסור',              icon: '➖', cat: 'חשבון' },
    { id: 'math-mul',      name: 'כפל',            desc: 'לוח הכפל',                  icon: '✖️', cat: 'חשבון' },
    { id: 'math-div',      name: 'חילוק',          desc: 'תרגילי חילוק',              icon: '➗', cat: 'חשבון' },
    { id: 'math-mixed',    name: 'מעורב',          desc: 'חיבור/חיסור/כפל',          icon: '🧮', cat: 'חשבון' },
    { id: 'writing-lines', name: 'שורות כתיבה',    desc: 'קווי כתיבה + כותרת',        icon: '✍️', cat: 'עברית' },
    { id: 'hebrew-trace',  name: 'אותיות לכתיבה',  desc: 'א-ת מנוקדת להעתקה',         icon: '🔤', cat: 'עברית' },
    { id: 'word-search',   name: 'תפזורת',         desc: 'חיפוש מילים',               icon: '🔍', cat: 'עברית' },
    { id: 'sudoku',        name: 'סודוקו',         desc: '4×4 / 9×9',                 icon: '🔢', cat: 'לוגיקה' },
    { id: 'sequence',      name: 'סדרות',          desc: 'השלם את הרצף',              icon: '🔗', cat: 'חשבון' },
    { id: 'clock',         name: 'שעון',           desc: 'מה השעה?',                  icon: '🕐', cat: 'חשבון' },
    { id: 'counting',      name: 'מנייה וצביעה',   desc: 'ספור וצבע (גן)',            icon: '🎨', cat: 'גן' },
  ];

  const DEFAULTS = {
    title: 'דף עבודה בחשבון',
    subtitle: '',
    instructions: 'פתור את התרגילים הבאים:',
    showStudentLine: true,
    showDateLine: true,
    addBsd: true,
    count: 20,
    cols: 2,
    range: '20',
    mulRange: '10',
    includeDivisionRemainder: false,
    writingLines: 12,
    guideLetter: 'א',
    wordList: 'שבת,תורה,חג,משפחה,בית,ספר,חבר,שמחה',
    gridSize: '10',
    sudokuSize: '6',
    seqType: 'add',
    clockCount: 6,
    countingMax: '10',
  };

  let state = loadState();
  let rerollSeed = Date.now();

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return Object.assign({ tpl: 'math-add' }, DEFAULTS, parsed);
      }
    } catch (e) {}
    return Object.assign({ tpl: 'math-add' }, DEFAULTS);
  }
  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
  }

  // ---- קטנות עזר ----
  function esc(s) { const d=document.createElement('div'); d.textContent=s==null?'':s; return d.innerHTML; }
  function randInt(a,b){ return Math.floor(Math.random()*(b-a+1))+a; }
  function shuffle(a){ const b=a.slice(); for(let i=b.length-1;i>0;i--){ const j=randInt(0,i); const t=b[i]; b[i]=b[j]; b[j]=t; } return b; }
  function tplById(id){ return TEMPLATES.find(t=>t.id===id) || TEMPLATES[0]; }

  // ---- אתחול DOM ----
  document.addEventListener('DOMContentLoaded', () => {
    renderTplMenu();
    wireGlobalEvents();
    applyStateToUI();
    renderLive();
  });

  function renderTplMenu(filter){
    const list = document.getElementById('tplList');
    if(!list) return;
    const q = (filter||'').trim();
    list.innerHTML='';
    const shown = TEMPLATES.filter(t => !q || (t.name+t.desc+t.cat).includes(q));
    shown.forEach(t=>{
      const btn=document.createElement('button');
      btn.type='button';
      btn.className='ws-tpl-card'+(t.id===state.tpl?' active':'');
      btn.dataset.id=t.id;
      btn.innerHTML=`<div class="t-icon">${t.icon}</div><div class="t-name">${esc(t.name)}</div><div class="t-desc">${esc(t.desc)}</div><div class="badge badge-neutral" style="margin-top:4px; font-size:10px; align-self:start;">${esc(t.cat)}</div>`;
      btn.addEventListener('click', ()=> selectTpl(t.id));
      list.appendChild(btn);
    });
    const hint=document.getElementById('tplCountHint');
    if(hint) hint.textContent = shown.length + ' תבניות' + (q ? ' (מסונן)' : ' מוכנות');
    const badge=document.getElementById('currentTplBadge');
    if(badge) badge.textContent = tplById(state.tpl).name;
  }

  function selectTpl(id){
    state.tpl=id;
    // כותרת ברירת מחדל לפי תבנית
    const mapTitle = {
      'math-add':'דף עבודה — חיבור',
      'math-sub':'דף עבודה — חיסור',
      'math-mul':'דף עבודה — כפל',
      'math-div':'דף עבודה — חילוק',
      'math-mixed':'דף עבודה — חשבון מעורב',
      'writing-lines':'דף כתיבה',
      'hebrew-trace':'אותיות לכתיבה',
      'word-search':'תפזורת — חיפוש מילים',
      'sudoku':'סודוקו',
      'sequence':'השלם את הסדרה',
      'clock':'מה השעה?',
      'counting':'ספור וצבע',
    };
    if(mapTitle[id]) state.title = mapTitle[id];
    saveState();
    applyStateToUI();
    renderTplMenu(document.getElementById('tplSearch')?.value||'');
    renderLive();
  }

  function wireGlobalEvents(){
    const search=document.getElementById('tplSearch');
    if(search) search.addEventListener('input', ()=> renderTplMenu(search.value));
    document.getElementById('btnReroll')?.addEventListener('click', ()=>{ rerollSeed=Date.now(); renderLive(true); });
    document.getElementById('btnPreview')?.addEventListener('click', openPreview);
    document.getElementById('btnPreview2')?.addEventListener('click', openPreview);
    document.getElementById('btnDownload')?.addEventListener('click', downloadPdf);
    document.getElementById('btnDownload2')?.addEventListener('click', downloadPdf);
    document.getElementById('btnDownloadFromPreview')?.addEventListener('click', downloadPdf);
    document.getElementById('btnCopyImage')?.addEventListener('click', copyImage);
    // modal backdrop close
    document.getElementById('previewModal')?.addEventListener('click', (e)=>{ if(e.target.id==='previewModal') closeModal('previewModal'); });
  }

  // ---- בקרים דינמים ----
  function applyStateToUI(){
    const body=document.getElementById('ctrlBody');
    if(!body) return;
    const t=tplById(state.tpl);
    document.getElementById('ctrlTitle').textContent = t.name + ' — הגדרות';
    // מבנה בקרים משותף + ספציפי
    let html = '';

    html += sectionHtml('כותרת ומסגרת', `
      <div class="field" style="margin:0;">
        <label>כותרת הדף</label>
        <input type="text" id="f_title" class="input" value="${esc(state.title)}" placeholder="לדוגמה: דף עבודה בחשבון">
      </div>
      <div class="field" style="margin:0;">
        <label>הוראות</label>
        <input type="text" id="f_instructions" class="input" value="${esc(state.instructions)}" placeholder="הוראות קצרות לתלמיד">
      </div>
      <div class="field" style="margin:0;">
        <label>שם מורה / כיתה (אופציונלי)</label>
        <input type="text" id="f_subtitle" class="input" value="${esc(state.subtitle)}" placeholder="כיתה ג׳ — מורת חשבון">
      </div>
      <div class="ws-grid2">
        <label class="checkbox-row" style="cursor:pointer; background:var(--surface-alt); padding:8px 10px; border-radius:var(--radius-sm); border:1px solid var(--border);">
          <input type="checkbox" id="f_showStudent" ${state.showStudentLine?'checked':''}> שורת שם
        </label>
        <label class="checkbox-row" style="cursor:pointer; background:var(--surface-alt); padding:8px 10px; border-radius:var(--radius-sm); border:1px solid var(--border);">
          <input type="checkbox" id="f_showDate" ${state.showDateLine?'checked':''}> שורת תאריך
        </label>
      </div>
      <label class="checkbox-row" style="cursor:pointer; background:var(--primary-tint); padding:8px 10px; border-radius:var(--radius-sm); border:1px solid var(--primary-tint-2); color:var(--primary-solid); font-weight:700;">
        <input type="checkbox" id="f_addBsd" ${state.addBsd?'checked':''}> הוסף <b style="font-weight:900;">בס"ד</b> בצד ימין למעלה
      </label>
      <div class="ws-hint">הבס"ד יופיע גם בתצוגה המקדימה וגם ב-PDF המוכן להורדה.</div>
    `);

    // בקרים ספציפיים לתבנית
    if(['math-add','math-sub','math-div','math-mixed'].includes(state.tpl)){
      html += sectionHtml('תרגילים', `
        <div class="ws-grid2">
          <div class="field" style="margin:0;">
            <label>כמות תרגילים</label>
            <select id="f_count" class="select">
              <option value="12" ${state.count==12?'selected':''}>12</option>
              <option value="20" ${state.count==20?'selected':''}>20</option>
              <option value="24" ${state.count==24?'selected':''}>24</option>
              <option value="30" ${state.count==30?'selected':''}>30</option>
              <option value="40" ${state.count==40?'selected':''}>40</option>
            </select>
          </div>
          <div class="field" style="margin:0;">
            <label>עמודות</label>
            <select id="f_cols" class="select">
              <option value="2" ${state.cols==2?'selected':''}>2</option>
              <option value="3" ${state.cols==3?'selected':''}>3</option>
              <option value="4" ${state.cols==4?'selected':''}>4</option>
            </select>
          </div>
        </div>
        <div class="field" style="margin:0;">
          <label>טווח מספרים</label>
          <select id="f_range" class="select">
            <option value="10" ${state.range=='10'?'selected':''}>עד 10</option>
            <option value="20" ${state.range=='20'?'selected':''}>עד 20</option>
            <option value="50" ${state.range=='50'?'selected':''}>עד 50</option>
            <option value="100" ${state.range=='100'?'selected':''}>עד 100</option>
            <option value="200" ${state.range=='200'?'selected':''}>עד 200</option>
          </select>
        </div>
      `);
    } else if(state.tpl==='math-mul'){
      html += sectionHtml('תרגילי כפל', `
        <div class="ws-grid2">
          <div class="field" style="margin:0;"><label>כמות</label><select id="f_count" class="select"><option value="12" ${state.count==12?'selected':''}>12</option><option value="20" ${state.count==20?'selected':''}>20</option><option value="24" ${state.count==24?'selected':''}>24</option><option value="30" ${state.count==30?'selected':''}>30</option></select></div>
          <div class="field" style="margin:0;"><label>עמודות</label><select id="f_cols" class="select"><option value="2" ${state.cols==2?'selected':''}>2</option><option value="3" ${state.cols==3?'selected':''}>3</option><option value="4" ${state.cols==4?'selected':''}>4</option></select></div>
        </div>
        <div class="field" style="margin:0;"><label>לוח כפל עד</label><select id="f_mulRange" class="select"><option value="5" ${state.mulRange=='5'?'selected':''}>5</option><option value="10" ${state.mulRange=='10'?'selected':''}>10</option><option value="12" ${state.mulRange=='12'?'selected':''}>12</option></select></div>
        <label class="checkbox-row" style="cursor:pointer; background:var(--surface-alt); padding:8px 10px; border-radius:var(--radius-sm); border:1px solid var(--border);"><input type="checkbox" id="f_showTable" ${state.showTable?'checked':''}> הצג גם לוח כפל קטן למעלה</label>
      `);
    } else if(state.tpl==='writing-lines'){
      html += sectionHtml('שורות כתיבה', `
        <div class="field" style="margin:0;"><label>מספר שורות</label><select id="f_writingLines" class="select"><option value="8" ${state.writingLines==8?'selected':''}>8</option><option value="12" ${state.writingLines==12?'selected':''}>12</option><option value="16" ${state.writingLines==16?'selected':''}>16</option><option value="20" ${state.writingLines==20?'selected':''}>20</option></select></div>
        <div class="field" style="margin:0;"><label>אות מנחה (תוצג מקווקו בשמאל השורה)</label><input type="text" id="f_guideLetter" class="input" maxlength="4" value="${esc(state.guideLetter)}" placeholder="א"></div>
        <div class="ws-hint">מתאים לכתיבה חופשית / העתקה. השורות הן קווי עזר אפורים עם שוליים אדומים.</div>
      `);
    } else if(state.tpl==='hebrew-trace'){
      html += sectionHtml('אותיות', `
        <div class="field" style="margin:0;"><label>אות לתרגול</label><select id="f_guideLetter" class="select">
          ${'אבגדהוזחטיכלמנסעפצקרשת'.split('').map(ch=>`<option value="${ch}" ${state.guideLetter===ch?'selected':''}>${ch}</option>`).join('')}
          <option value="א-ת" ${state.guideLetter==='א-ת'?'selected':''}>כל האלף-בית (א-ת)</option>
        </select></div>
        <div class="field" style="margin:0;"><label>שורות</label><select id="f_writingLines" class="select"><option value="6" ${state.writingLines==6?'selected':''}>6</option><option value="8" ${state.writingLines==8?'selected':''}>8</option><option value="10" ${state.writingLines==10?'selected':''}>10</option><option value="12" ${state.writingLines==12?'selected':''}>12</option></select></div>
        <div class="ws-hint">כל שורה: 6 אותיות מנוקדות מקווקוות להעתקה + קו כתיבה.</div>
      `);
    } else if(state.tpl==='word-search'){
      html += sectionHtml('תפזורת', `
        <div class="field" style="margin:0;"><label>רשימת מילים (פסיק בין מילים)</label><textarea id="f_wordList" class="textarea" rows="3" style="min-height:70px; font-size:12.5px;">${esc(state.wordList)}</textarea></div>
        <div class="field" style="margin:0;"><label>גודל לוח</label><select id="f_gridSize" class="select"><option value="8" ${state.gridSize=='8'?'selected':''}>8×8</option><option value="10" ${state.gridSize=='10'?'selected':''}>10×10</option><option value="12" ${state.gridSize=='12'?'selected':''}>12×12</option></select></div>
        <div class="ws-hint">המערכת משבצת אוטומטית אופקית/אנכית. בכיוון קריאה עברית (ימין לשמאל).</div>
      `);
    } else if(state.tpl==='sudoku'){
      html += sectionHtml('סודוקו', `
        <div class="field" style="margin:0;"><label>גודל</label><select id="f_sudokuSize" class="select"><option value="4" ${state.sudokuSize=='4'?'selected':''}>4×4 (קל)</option><option value="6" ${state.sudokuSize=='6'?'selected':''}>6×6</option><option value="9" ${state.sudokuSize=='9'?'selected':''}>9×9</option></select></div>
        <div class="field" style="margin:0;"><label>רמת קושי</label><select id="f_sudokuDiff" class="select"><option value="easy" ${state.sudokuDiff==='easy'?'selected':''}>קל</option><option value="mid" ${state.sudokuDiff==='mid'?'selected':''}>בינוני</option><option value="hard" ${state.sudokuDiff==='hard'?'selected':''}>קשה</option></select></div>
      `);
    } else if(state.tpl==='sequence'){
      html += sectionHtml('סדרות', `
        <div class="field" style="margin:0;"><label>סוג סדרה</label><select id="f_seqType" class="select"><option value="add" ${state.seqType==='add'?'selected':''}>הוספה קבועה</option><option value="sub" ${state.seqType==='sub'?'selected':''}>החסרה</option><option value="mul" ${state.seqType==='mul'?'selected':''}>כפל</option><option value="mixed" ${state.seqType==='mixed'?'selected':''}>מעורב</option></select></div>
        <div class="ws-grid2"><div class="field" style="margin:0;"><label>כמות סדרות</label><select id="f_count" class="select"><option value="6" ${state.count==6?'selected':''}>6</option><option value="8" ${state.count==8?'selected':''}>8</option><option value="10" ${state.count==10?'selected':''}>10</option><option value="12" ${state.count==12?'selected':''}>12</option></select></div><div class="field" style="margin:0;"><label>עמודות</label><select id="f_cols" class="select"><option value="1" ${state.cols==1?'selected':''}>1</option><option value="2" ${state.cols==2?'selected':''}>2</option></select></div></div>
      `);
    } else if(state.tpl==='clock'){
      html += sectionHtml('שעון', `
        <div class="field" style="margin:0;"><label>כמות שעונים</label><select id="f_clockCount" class="select"><option value="4" ${state.clockCount==4?'selected':''}>4</option><option value="6" ${state.clockCount==6?'selected':''}>6</option><option value="8" ${state.clockCount==8?'selected':''}>8</option><option value="9" ${state.clockCount==9?'selected':''}>9</option></select></div>
        <div class="ws-hint">כל שעון מציג שעה עגולה/חצי. התלמיד כותב את השעה בקו.</div>
      `);
    } else if(state.tpl==='counting'){
      html += sectionHtml('מנייה', `
        <div class="field" style="margin:0;"><label>עד כמה לספור</label><select id="f_countingMax" class="select"><option value="5" ${state.countingMax=='5'?'selected':''}>5</option><option value="10" ${state.countingMax=='10'?'selected':''}>10</option><option value="20" ${state.countingMax=='20'?'selected':''}>20</option></select></div>
        <div class="field" style="margin:0;"><label>כמות תרגילים</label><select id="f_count" class="select"><option value="6" ${state.count==6?'selected':''}>6</option><option value="8" ${state.count==8?'selected':''}>8</option><option value="10" ${state.count==10?'selected':''}>10</option></select></div>
      `);
    }

    body.innerHTML = html;
    // wire inputs
    const bind = (id, key, parse) => {
      const el=document.getElementById(id);
      if(!el) return;
      const ev = el.tagName==='SELECT' || el.type==='checkbox' ? 'change' : 'input';
      el.addEventListener(ev, ()=>{
        let v = el.type==='checkbox' ? el.checked : el.value;
        if(parse) v=parse(v);
        state[key]=v;
        saveState();
        if(document.getElementById('autoPreviewCheck')?.checked) renderLive();
      });
    };
    bind('f_title','title');
    bind('f_subtitle','subtitle');
    bind('f_instructions','instructions');
    bind('f_showStudent','showStudentLine', v=> !!v);
    bind('f_showDate','showDateLine', v=> !!v);
    bind('f_addBsd','addBsd', v=> !!v);
    bind('f_count','count', v=> parseInt(v,10));
    bind('f_cols','cols', v=> parseInt(v,10));
    bind('f_range','range');
    bind('f_mulRange','mulRange');
    bind('f_writingLines','writingLines', v=> parseInt(v,10));
    bind('f_guideLetter','guideLetter');
    bind('f_wordList','wordList');
    bind('f_gridSize','gridSize');
    bind('f_sudokuSize','sudokuSize');
    bind('f_sudokuDiff','sudokuDiff');
    bind('f_seqType','seqType');
    bind('f_clockCount','clockCount', v=> parseInt(v,10));
    bind('f_countingMax','countingMax');
    // כפתור מיוחד ללוח כפל
    const showTableEl=document.getElementById('f_showTable');
    if(showTableEl){
      showTableEl.addEventListener('change', ()=>{
        state.showTable = showTableEl.checked;
        saveState();
        if(document.getElementById('autoPreviewCheck')?.checked) renderLive();
      });
    }
  }

  function sectionHtml(title, inner){
    return `<div class="ws-section"><div class="ws-section-title"><svg class="icon" viewBox="0 0 24 24" style="width:13px;height:13px;"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 9 15a1.65 1.65 0 0 0-1-1.51A1.65 1.65 0 0 0 6.18 13l-.06-.06A2 2 0 0 1 8.95 10.1l.06.06A1.65 1.65 0 0 0 10.83 10.5 1.65 1.65 0 0 0 12 9a1.65 1.65 0 0 0-1-1.51A1.65 1.65 0 0 0 9.18 7l-.06-.06A2 2 0 0 1 11.95 4.1l.06.06A1.65 1.65 0 0 0 13.83 4.5 1.65 1.65 0 0 0 15 6a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06A2 2 0 0 1 20.71 9.95l-.06.06A1.65 1.65 0 0 0 19.4 12a1.65 1.65 0 0 0 1 1.51V15z"/></svg> ${esc(title)}</div>${inner}</div>`;
  }

  // ---- רינדור חי ----
  function renderLive(force){
    const canvas=document.getElementById('wsCanvas');
    if(!canvas) return;
    // debounce קטן
    if(!force && renderLive._t) clearTimeout(renderLive._t);
    const run=()=>{
      drawWorksheet(canvas, state, rerollSeed);
      // עדכון פוטר מידע
      const info=document.getElementById('pageInfoBadge');
      const meta=document.getElementById('pageMetaHint');
      const t=tplById(state.tpl);
      if(info) info.textContent = t.name + ' · A4';
      if(meta) meta.textContent = state.title + (state.addBsd ? ' · עם בס"ד' : ' · בלי בס"ד');
      // previewCanvas אם פתוח
      const pc=document.getElementById('previewCanvas');
      if(pc && document.getElementById('previewModal')?.classList.contains('open')){
        copyToPreview();
      }
    };
    if(force) run();
    else renderLive._t=setTimeout(run, 90);
  }

  // ---- ציור דף מרכזי ----
  function drawWorksheet(canvas, opts, seed){
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    // שמור גודל לוגי 794x1123 (A4 96dpi) אבל רנדר חד
    const W=794, H=1123;
    canvas.width=W;
    canvas.height=H;
    const ctx=canvas.getContext('2d');
    ctx.setTransform(1,0,0,1,0,0);
    ctx.fillStyle='#ffffff';
    ctx.fillRect(0,0,W,H);

    // שוליים
    const marginL=40, marginR=40, marginT=36, marginB=36;
    const contentW=W - marginL - marginR;

    // בס"ד
    if(opts.addBsd){
      ctx.save();
      ctx.fillStyle='#6b7280';
      ctx.font='400 11px "Assistant","Segoe UI",Arial';
      ctx.textAlign='right';
      ctx.textBaseline='top';
      // ימין למעלה
      ctx.fillText('בס"ד', W - marginR, 14);
      ctx.restore();
    }

    // כותרת
    let y= marginT + (opts.addBsd? 10:0);
    ctx.fillStyle='#1f2328';
    ctx.textAlign='center';
    ctx.font='900 26px "Assistant","Segoe UI",Arial';
    // כותרת מרכזית
    y+=8;
    ctx.fillText(opts.title || 'דף עבודה', W/2, y);
    y+=30;
    if(opts.subtitle){
      ctx.font='600 12.5px "Assistant","Segoe UI",Arial';
      ctx.fillStyle='#6b7280';
      ctx.fillText(opts.subtitle, W/2, y);
      y+=18;
      ctx.fillStyle='#1f2328';
    }
    // שורת שם/תאריך
    if(opts.showStudentLine || opts.showDateLine){
      y+=6;
      ctx.strokeStyle='#d1d5db';
      ctx.lineWidth=1;
      const lineY=y;
      // קו תלמיד
      if(opts.showStudentLine){
        const label='שם התלמיד:';
        ctx.font='600 11px "Assistant","Segoe UI",Arial';
        ctx.textAlign='right';
        ctx.fillStyle='#374151';
        const lx = W - marginR;
        ctx.fillText(label, lx, lineY-7);
        const textW = ctx.measureText(label).width;
        const lineX1 = W - marginR - textW - 10;
        const lineX2 = lineX1 - 190;
        ctx.beginPath(); ctx.moveTo(lineX2, lineY); ctx.lineTo(lineX1, lineY); ctx.stroke();
      }
      if(opts.showDateLine){
        const label='תאריך:';
        ctx.font='600 11px "Assistant","Segoe UI",Arial';
        ctx.textAlign='right';
        ctx.fillText(label, W - marginR - (opts.showStudentLine? 250:0), lineY-7);
        const lx = W - marginR - (opts.showStudentLine? 250:0);
        const tw = ctx.measureText(label).width;
        const x1 = lx - tw - 10;
        const x2 = x1 - 120;
        ctx.beginPath(); ctx.moveTo(x2, lineY); ctx.lineTo(x1, lineY); ctx.stroke();
      }
      // קו כיתה/ציון בצד שמאל
      if(opts.showStudentLine){
        ctx.font='600 11px "Assistant","Segoe UI",Arial';
        ctx.textAlign='left';
        ctx.fillText('כיתה:', marginL, lineY-7);
        const tw2 = ctx.measureText('כיתה:').width;
        ctx.beginPath(); ctx.moveTo(marginL+tw2+6, lineY); ctx.lineTo(marginL+tw2+6+90, lineY); ctx.stroke();
        ctx.textAlign='center';
      }
      y+=18;
    }

    // הוראות
    if(opts.instructions){
      y+=4;
      ctx.fillStyle='#7c2e4d';
      ctx.font='700 12px "Assistant","Segoe UI",Arial';
      ctx.textAlign='right';
      ctx.fillText(opts.instructions, W - marginR, y);
      y+=16;
      ctx.fillStyle='#e5d8cb';
      ctx.fillRect(marginL, y, contentW, 1);
      y+=10;
    } else {
      y+=8;
    }

    // אזור התוכן
    const contentY=y;
    const contentH = H - marginB - contentY;
    ctx.save();
    ctx.beginPath();
    ctx.rect(marginL, contentY, contentW, contentH);
    ctx.clip();
    // קריאה לפי תבנית
    drawByTemplate(ctx, marginL, contentY, contentW, contentH, opts, seed);
    ctx.restore();

    // מספר עמוד / פוטר קטן
    ctx.fillStyle='#9ca3af';
    ctx.font='400 9px "Assistant","Segoe UI",Arial';
    ctx.textAlign='center';
    ctx.fillText('דף 1  •  מחולל דפי עבודה — המערכת המרכזית', W/2, H - 18);
  }

  function drawByTemplate(ctx, x, y, w, h, opts, seed){
    switch(opts.tpl){
      case 'math-add': return drawMath(ctx,x,y,w,h,opts,'add');
      case 'math-sub': return drawMath(ctx,x,y,w,h,opts,'sub');
      case 'math-mul': return drawMathMul(ctx,x,y,w,h,opts);
      case 'math-div': return drawMath(ctx,x,y,w,h,opts,'div');
      case 'math-mixed': return drawMath(ctx,x,y,w,h,opts,'mixed');
      case 'writing-lines': return drawWritingLines(ctx,x,y,w,h,opts);
      case 'hebrew-trace': return drawHebrewTrace(ctx,x,y,w,h,opts);
      case 'word-search': return drawWordSearch(ctx,x,y,w,h,opts,seed);
      case 'sudoku': return drawSudoku(ctx,x,y,w,h,opts,seed);
      case 'sequence': return drawSequence(ctx,x,y,w,h,opts,seed);
      case 'clock': return drawClock(ctx,x,y,w,h,opts,seed);
      case 'counting': return drawCounting(ctx,x,y,w,h,opts,seed);
      default: return drawMath(ctx,x,y,w,h,opts,'add');
    }
  }

  // ---- חשבון ----
  function drawMath(ctx, x, y, w, h, opts, kind){
    const cols = Math.max(2, Math.min(4, opts.cols||2));
    const count = opts.count||20;
    const range = parseInt(opts.range||'20',10);
    const colW = w / cols;
    const rowH = 44;
    const rows = Math.ceil(count / cols);
    // אם לא נכנס — נקטין רווח
    const startY = y + 6;

    const exercises=[];
    for(let i=0;i<count;i++){
      let a,b,ans,op;
      if(kind==='add'){
        a=randInt(1,range); b=randInt(1, Math.min(range, range-a+5)); if(a+b>range && range<=20){ a=randInt(1,10); b=randInt(1,10); } ans=a+b; op='+';
      } else if(kind==='sub'){
        a=randInt(5,range); b=randInt(1, Math.min(a-1, range)); ans=a-b; op='−';
      } else if(kind==='div'){
        b=randInt(2, Math.min(12, range)); ans=randInt(1, Math.min(12, range)); a=b*ans; op='÷';
      } else if(kind==='mixed'){
        const r=Math.random();
        if(r<0.34){ a=randInt(2,range); b=randInt(1,10); ans=a+b; op='+'; if(ans>range) { a=randInt(1,range-5); b=randInt(1,10); ans=a+b; } }
        else if(r<0.66){ a=randInt(5,range); b=randInt(1,a-1); ans=a-b; op='−'; }
        else { b=randInt(2,10); ans=randInt(1,10); a=b*ans; op='×'; }
      }
      exercises.push({a,b,op,ans, idx:i+1});
    }

    exercises.forEach((ex,i)=>{
      const col=i % cols;
      const row=Math.floor(i/cols);
      const cx=x + col*colW;
      const cy=startY + row*rowH;
      if(cy+rowH > y+h-6) return;
      // כרטיס תרגיל
      const pad=8;
      const cardX=cx+6, cardY=cy, cardW=colW-12, cardH=rowH-8;
      ctx.fillStyle='#faf7f2';
      ctx.strokeStyle='#e5d8cb';
      ctx.lineWidth=1;
      roundRect(ctx, cardX, cardY, cardW, cardH, 8, true, true);
      // מספר תרגיל
      ctx.fillStyle='#7c2e4d';
      ctx.font='800 9px "Assistant","Segoe UI",Arial';
      ctx.textAlign='right';
      ctx.fillText(String(ex.idx)+'.', cardX+cardW-8, cardY+12);
      // תרגיל עצמו — מרכז
      ctx.fillStyle='#1f2328';
      ctx.font='700 15px "Assistant","Segoe UI",Arial';
      ctx.textAlign='center';
      const midY=cardY+22;
      // לוגיקה: a op b = ___
      // עברית: המספרים לועזיים, אבל סימן = בצד שמאל
      const line = `${ex.a}  ${ex.op}  ${ex.b}  =`;
      ctx.fillText(line, cardX+cardW/2 - 18, midY);
      // קו תשובה
      const ansX = cardX+cardW/2 + 28;
      ctx.strokeStyle='#9ca3af';
      ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(ansX, midY+2); ctx.lineTo(ansX+56, midY+2); ctx.stroke();
      // נקודות עזר קטנות מתחת
      ctx.fillStyle='#d1d5db';
      ctx.beginPath(); ctx.arc(cardX+cardW/2, cardY+cardH-7, 1.5, 0, Math.PI*2); ctx.fill();
    });
  }

  function drawMathMul(ctx,x,y,w,h,opts){
    // כפל — כולל אופציה ללוח כפל
    let curY=y+4;
    if(opts.showTable){
      // לוח כפל קטן
      const n=parseInt(opts.mulRange||'10',10);
      const cell= Math.min(22, (w-20)/ (n+1));
      const tableW=(n+1)*cell;
      const tableH=(n+1)*cell;
      const tx=x + (w-tableW)/2;
      const ty=curY;
      // כותרת
      ctx.fillStyle='#7c2e4d';
      ctx.font='700 11px "Assistant","Segoe UI",Arial';
      ctx.textAlign='center';
      ctx.fillText('לוח הכפל — לעזר', x+w/2, ty-4);
      // רשת
      for(let r=0;r<=n;r++){
        for(let c=0;c<=n;c++){
          const cx=tx + c*cell, cy=ty + r*cell;
          ctx.strokeStyle='#e5d8cb';
          ctx.lineWidth=0.8;
          ctx.strokeRect(cx,cy,cell,cell);
          if(r===0 && c===0){
            ctx.fillStyle='#7c2e4d';
            ctx.fillRect(cx,cy,cell,cell);
            ctx.fillStyle='#fff';
            ctx.font='800 9px "Assistant",Arial';
            ctx.textAlign='center';
            ctx.fillText('×', cx+cell/2, cy+cell/2+3);
          } else if(r===0){
            ctx.fillStyle='#f4eee6';
            ctx.fillRect(cx,cy,cell,cell);
            ctx.fillStyle='#7c2e4d';
            ctx.font='700 9px "Assistant",Arial';
            ctx.textAlign='center';
            ctx.fillText(String(c), cx+cell/2, cy+cell/2+3);
          } else if(c===0){
            ctx.fillStyle='#f4eee6';
            ctx.fillRect(cx,cy,cell,cell);
            ctx.fillStyle='#7c2e4d';
            ctx.font='700 9px "Assistant",Arial';
            ctx.fillText(String(r), cx+cell/2, cy+cell/2+3);
          } else {
            ctx.fillStyle='#1f2328';
            ctx.font='600 8px "Assistant",Arial';
            ctx.textAlign='center';
            ctx.fillText(String(r*c), cx+cell/2, cy+cell/2+3);
          }
        }
      }
      curY = ty + tableH + 14;
      ctx.fillStyle='#e5d8cb'; ctx.fillRect(x, curY, w, 1); curY+=10;
    }
    // תרגילים
    const remainH = y+h - curY;
    // צייר תרגילי כפל רגילים
    const fakeOpts = Object.assign({}, opts, {count: opts.count||20, cols: opts.cols||2});
    // נשמור curY ע"י טריק: נזיז y
    drawMathAt(ctx, x, curY, w, remainH, fakeOpts, 'mul');
  }
  function drawMathAt(ctx,x,y,w,h,opts,kind){
    const cols=Math.max(2,Math.min(4, opts.cols||2));
    const count=opts.count||20;
    const mulMax=parseInt(opts.mulRange||'10',10);
    const colW=w/cols, rowH=44;
    const startY=y+2;
    for(let i=0;i<count;i++){
      const a=randInt(2,mulMax), b=randInt(2,mulMax);
      const idx=i+1;
      const col=i%cols, row=Math.floor(i/cols);
      const cx=x+col*colW, cy=startY+row*rowH;
      if(cy+rowH>y+h) break;
      const cardX=cx+6, cardY=cy, cardW=colW-12, cardH=rowH-8;
      ctx.fillStyle='#faf7f2'; ctx.strokeStyle='#e5d8cb'; ctx.lineWidth=1;
      roundRect(ctx,cardX,cardY,cardW,cardH,8,true,true);
      ctx.fillStyle='#7c2e4d'; ctx.font='800 9px "Assistant",Arial'; ctx.textAlign='right';
      ctx.fillText(String(idx)+'.', cardX+cardW-8, cardY+12);
      ctx.fillStyle='#1f2328'; ctx.font='700 15px "Assistant",Arial'; ctx.textAlign='center';
      ctx.fillText(`${a}  ×  ${b}  =`, cardX+cardW/2-18, cardY+22);
      ctx.strokeStyle='#9ca3af'; ctx.beginPath(); ctx.moveTo(cardX+cardW/2+28, cardY+24); ctx.lineTo(cardX+cardW/2+78, cardY+24); ctx.stroke();
    }
  }

  // ---- שורות כתיבה ----
  function drawWritingLines(ctx,x,y,w,h,opts){
    const n=opts.writingLines||12;
    const gap = (h-10) / n;
    const top=y+6;
    // כותרת אות מנחה גדולה מקווקוות בצד
    for(let i=0;i<n;i++){
      const lineY=top + i*gap;
      // שורה: קו אדום שוליים, 3 קווי עזר
      // שוליים
      ctx.strokeStyle='#fecaca';
      ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(x, lineY+gap-8); ctx.lineTo(x+w, lineY+gap-8); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x+36, lineY); ctx.lineTo(x+36, lineY+gap-6); ctx.stroke();
      // קווי כתיבה
      const base=lineY+gap-18;
      ctx.strokeStyle='#d1d5db';
      ctx.lineWidth=0.8;
      // עליון
      ctx.beginPath(); ctx.moveTo(x+40, base-26); ctx.lineTo(x+w-6, base-26); ctx.stroke();
      // אמצע מקווקו
      ctx.setLineDash([4,4]);
      ctx.beginPath(); ctx.moveTo(x+40, base-13); ctx.lineTo(x+w-6, base-13); ctx.stroke();
      ctx.setLineDash([]);
      // תחתון
      ctx.strokeStyle='#9ca3af';
      ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(x+40, base); ctx.lineTo(x+w-6, base); ctx.stroke();

      // אות מנחה שמאל
      if(opts.guideLetter){
        ctx.save();
        ctx.fillStyle='#e5d8cb';
        ctx.font='300 28px "Assistant","Segoe UI",Arial';
        ctx.textAlign='left';
        ctx.globalAlpha=0.9;
        // אות מקווקוות — נצייר עם setLineDash על קונטור? פשוט טקסט אפור בהיר
        ctx.fillText(opts.guideLetter, x+8, base-2);
        // קווקו מעל הטקסט
        ctx.strokeStyle='#7c2e4d';
        ctx.lineWidth=0.7;
        ctx.setLineDash([3,3]);
        ctx.strokeText(opts.guideLetter, x+8, base-2);
        ctx.restore();
      }
    }
  }

  // ---- אותיות לכתיבה (א-ת) ----
  function drawHebrewTrace(ctx,x,y,w,h,opts){
    const letters = opts.guideLetter==='א-ת' ? 'אבגדהוזחטיכלמנסעפצקרשת'.split('') : [opts.guideLetter||'א'];
    const rows = opts.writingLines||8;
    const gap=(h-6)/rows;
    let idx=0;
    for(let r=0;r<rows;r++){
      const lineY=y+8 + r*gap;
      const base=lineY+gap-18;
      // רקע שורה
      ctx.fillStyle='#faf7f2';
      roundRect(ctx, x, lineY, w, gap-8, 8, true, false);
      ctx.strokeStyle='#e5d8cb'; ctx.lineWidth=1;
      roundRect(ctx, x, lineY, w, gap-8, 8, false, true);
      // קווי עזר
      ctx.strokeStyle='#d1d5db'; ctx.lineWidth=0.7;
      ctx.beginPath(); ctx.moveTo(x+10, base-26); ctx.lineTo(x+w-10, base-26); ctx.stroke();
      ctx.setLineDash([4,4]); ctx.beginPath(); ctx.moveTo(x+10, base-13); ctx.lineTo(x+w-10, base-13); ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle='#9ca3af'; ctx.beginPath(); ctx.moveTo(x+10, base); ctx.lineTo(x+w-10, base); ctx.stroke();
      // 6 אותיות מקווקוות
      const startX= x+14;
      const step=(w-28)/6;
      for(let c=0;c<6;c++){
        const ch = letters[(idx+c) % letters.length];
        const cx=startX + c*step + step/2;
        ctx.save();
        ctx.fillStyle='#ffffff';
        ctx.strokeStyle='#7c2e4d';
        ctx.lineWidth=1.2;
        ctx.font='300 32px "Assistant","Segoe UI",Arial';
        ctx.textAlign='center';
        ctx.setLineDash([3,3]);
        // ציור מקווקו: גם fill בהיר וגם stroke מקווקו
        ctx.globalAlpha=0.18;
        ctx.fillText(ch, cx, base-4);
        ctx.globalAlpha=1;
        ctx.strokeText(ch, cx, base-4);
        ctx.restore();
        // נקודת התחלה קטנה
        ctx.fillStyle='#7c2e4d';
        ctx.beginPath(); ctx.arc(cx-10, base-22, 2, 0, Math.PI*2); ctx.fill();
      }
      idx+=1;
      // חץ כיוון
      ctx.fillStyle='#9ca3af';
      ctx.font='600 8px "Assistant",Arial';
      ctx.textAlign='left';
      ctx.fillText('← כיוון כתיבה', x+w-78, lineY+10);
    }
  }

  // ---- תפזורת ----
  function drawWordSearch(ctx,x,y,w,h,opts,seed){
    const raw=(opts.wordList||'').split(',').map(s=>s.trim()).filter(Boolean);
    const words = raw.length? raw.slice(0,10) : ['שבת','תורה'];
    const n=parseInt(opts.gridSize||'10',10);
    const cell = Math.min( Math.floor(w/n), Math.floor((h-90)/n), 36);
    const gridW=n*cell, gridH=n*cell;
    const gx=x + (w-gridW)/2, gy=y+6;

    // בנה לוח ריק
    const grid=Array.from({length:n},()=>Array(n).fill(''));
    const placed=[];
    // נסה לשבץ כל מילה
    words.forEach(word=>{
      // נקה ניקוד? נשאר
      const dir = Math.random()<0.6 ? 'h' : 'v'; // אופקית או אנכית
      let placedOk=false;
      for(let attempt=0; attempt<60; attempt++){
        if(dir==='h'){
          const r=randInt(0,n-1), c=randInt(0, n - word.length);
          let ok=true;
          for(let k=0;k<word.length;k++) if(grid[r][c+k] && grid[r][c+k]!==word[k]){ ok=false; break; }
          if(ok){ for(let k=0;k<word.length;k++) grid[r][c+k]=word[k]; placed.push({word, r,c,dir}); placedOk=true; break; }
        } else {
          const r=randInt(0, n - word.length), c=randInt(0,n-1);
          let ok=true;
          for(let k=0;k<word.length;k++) if(grid[r+k][c] && grid[r+k][c]!==word[k]){ ok=false; break; }
          if(ok){ for(let k=0;k<word.length;k++) grid[r+k][c]=word[k]; placed.push({word, r,c,dir}); placedOk=true; break; }
        }
      }
      if(!placedOk) placed.push({word, missing:true});
    });
    // מלא ריקים באותיות רנדומליות
    const aleph='אבגדהוזחטיכלמנסעפצקרשת';
    for(let r=0;r<n;r++) for(let c=0;c<n;c++) if(!grid[r][c]) grid[r][c]=aleph[randInt(0,aleph.length-1)];

    // צייר מסגרת
    ctx.fillStyle='#ffffff';
    ctx.strokeStyle='#e5d8cb'; ctx.lineWidth=1.2;
    roundRect(ctx, gx-4, gy-4, gridW+8, gridH+8, 10, true, true);
    // תאים
    for(let r=0;r<n;r++){
      for(let c=0;c<n;c++){
        const cx=gx + c*cell, cy=gy + r*cell;
        ctx.strokeStyle='#eef2f7';
        ctx.strokeRect(cx,cy,cell,cell);
        ctx.fillStyle='#1f2328';
        ctx.font=`700 ${Math.max(12, cell*0.5)}px "Assistant",Arial`;
        ctx.textAlign='center';
        ctx.textBaseline='middle';
        ctx.fillText(grid[r][c], cx+cell/2, cy+cell/2+1);
      }
    }
    // רשימת מילים למטה
    const listY= gy + gridH + 18;
    ctx.fillStyle='#7c2e4d';
    ctx.font='800 11px "Assistant",Arial';
    ctx.textAlign='center';
    ctx.fillText('מילים לחיפוש — הקיפו בעיגול:', x+w/2, listY);
    // מילים בשורה
    ctx.font='700 11px "Assistant",Arial';
    ctx.fillStyle='#1f2328';
    ctx.textAlign='right'; // אבל נחלק ידנית
    // נצייר כ- badges
    let curX = x + w - 10;
    let curY2 = listY + 14;
    const maxW = w - 20;
    // נמדוד
    ctx.textAlign='right';
    // פשוט בשורה אחת עם פסיקים — מרכז
    const wordsStr = words.join('  •  ');
    ctx.textAlign='center';
    // שבירת שורה פשוטה
    const wordsPerLine= Math.ceil(words.length/2);
    if(words.length>6){
      ctx.fillText(words.slice(0,wordsPerLine).join('  •  '), x+w/2, curY2);
      ctx.fillText(words.slice(wordsPerLine).join('  •  '), x+w/2, curY2+16);
    } else {
      ctx.fillText(wordsStr, x+w/2, curY2);
    }
    // הערה קטנה
    ctx.fillStyle='#9ca3af';
    ctx.font='400 8px "Assistant",Arial';
    ctx.fillText('מילים יכולות להופיע אופקית או אנכית (ימין לשמאל)', x+w/2, curY2+30);
  }

  // ---- סודוקו ----
  function drawSudoku(ctx,x,y,w,h,opts){
    const n=parseInt(opts.sudokuSize||'6',10);
    let size=n;
    if(size!==4 && size!==6 && size!==9) size=6;
    const is9=size===9, is4=size===4;
    // גודל תא
    const maxCell = Math.min( Math.floor((w-40)/size), Math.floor((h-80)/size), 48);
    const cell=maxCell;
    const gridW=size*cell, gridH=size*cell;
    const gx=x + (w-gridW)/2, gy=y+10;

    // יצירת לוח פתור ואז הסרה
    const board = generateSudokuBoard(size);
    const puzzle = punchHoles(board, size, opts.sudokuDiff||'mid');

    // רקע
    ctx.fillStyle='#ffffff';
    ctx.strokeStyle='#e5d8cb'; ctx.lineWidth=1;
    roundRect(ctx, gx-6, gy-6, gridW+12, gridH+12, 10, true, true);

    // תאים
    for(let r=0;r<size;r++){
      for(let c=0;c<size;c++){
        const cx=gx + c*cell, cy=gy + r*cell;
        ctx.fillStyle = puzzle[r][c] ? '#ffffff' : '#faf7f2';
        ctx.fillRect(cx,cy,cell,cell);
        ctx.strokeStyle='#d1d5db'; ctx.lineWidth=0.8;
        ctx.strokeRect(cx,cy,cell,cell);
        if(puzzle[r][c]){
          ctx.fillStyle='#1f2328';
          ctx.font=`800 ${Math.max(13, cell*0.45)}px "Assistant",Arial`;
          ctx.textAlign='center'; ctx.textBaseline='middle';
          ctx.fillText(String(puzzle[r][c]), cx+cell/2, cy+cell/2+1);
        }
      }
    }
    // קווי בלוק עבים
    ctx.strokeStyle='#7c2e4d'; ctx.lineWidth=2;
    if(size===9){
      for(let b=0;b<=3;b++){
        const v=gx + b*3*cell;
        const hz=gy + b*3*cell;
        ctx.beginPath(); ctx.moveTo(v, gy); ctx.lineTo(v, gy+gridH); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(gx, hz); ctx.lineTo(gx+gridW, hz); ctx.stroke();
      }
    } else if(size===6){
      // 2x3 בלוקים
      ctx.beginPath(); ctx.moveTo(gx+3*cell, gy); ctx.lineTo(gx+3*cell, gy+gridH); ctx.stroke();
      for(let r=0;r<=3;r++){ const yy=gy + r*2*cell; ctx.beginPath(); ctx.moveTo(gx,yy); ctx.lineTo(gx+gridW,yy); ctx.stroke(); }
    } else if(size===4){
      ctx.beginPath(); ctx.moveTo(gx+2*cell, gy); ctx.lineTo(gx+2*cell, gy+gridH); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(gx, gy+2*cell); ctx.lineTo(gx+gridW, gy+2*cell); ctx.stroke();
    }
    // כותרת קטנה
    ctx.fillStyle='#6b7280'; ctx.font='600 9px "Assistant",Arial'; ctx.textAlign='center';
    ctx.fillText(`מלא את המספרים 1-${size} — כל שורה, עמודה ובלוק פעם אחת`, x+w/2, gy+gridH+18);
  }
  function generateSudokuBoard(n){
    if(n===4){
      // לוח 4 פתור פשוט
      const base=[[1,2,3,4],[3,4,1,2],[2,1,4,3],[4,3,2,1]];
      return shuffleRowsCols(base,4);
    }
    if(n===6){
      // 6x6: נבנה ידנית ואז ערבוב
      const b=[
        [1,2,3,4,5,6],
        [4,5,6,1,2,3],
        [2,3,1,5,6,4],
        [5,6,4,2,3,1],
        [3,1,2,6,4,5],
        [6,4,5,3,1,2],
      ];
      return shuffleRowsCols(b,6);
    }
    // 9x9 — backtracking קל
    const board=Array.from({length:9},()=>Array(9).fill(0));
    function isValid(br, r,c, v){
      for(let i=0;i<9;i++) if(br[r][i]===v || br[i][c]===v) return false;
      const br0=Math.floor(r/3)*3, bc0=Math.floor(c/3)*3;
      for(let rr=0;rr<3;rr++) for(let cc=0;cc<3;cc++) if(br[br0+rr][bc0+cc]===v) return false;
      return true;
    }
    function solve(br, idx){
      if(idx>=81) return true;
      const r=Math.floor(idx/9), c=idx%9;
      if(br[r][c]!==0) return solve(br, idx+1);
      const nums=shuffle([1,2,3,4,5,6,7,8,9]);
      for(const v of nums){
        if(isValid(br,r,c,v)){ br[r][c]=v; if(solve(br,idx+1)) return true; br[r][c]=0; }
      }
      return false;
    }
    solve(board,0);
    return board;
  }
  function shuffleRowsCols(board,n){
    // ערבוב שורות/עמודות בתוך בלוקים
    let b=board.map(r=>r.slice());
    if(n===4){
      if(Math.random()<0.5){ const t=b[0]; b[0]=b[1]; b[1]=t; }
      if(Math.random()<0.5){ const t=b[2]; b[2]=b[3]; b[3]=t; }
    }
    return b;
  }
  function punchHoles(board,n,diff){
    const p=board.map(r=>r.slice());
    const holes = diff==='easy' ? Math.floor(n*n*0.35) : diff==='hard' ? Math.floor(n*n*0.6) : Math.floor(n*n*0.48);
    let count=0;
    const positions=shuffle(Array.from({length:n*n},(_,i)=>i));
    for(const pos of positions){
      if(count>=holes) break;
      const r=Math.floor(pos/n), c=pos%n;
      p[r][c]=0;
      count++;
    }
    return p;
  }

  // ---- סדרות ----
  function drawSequence(ctx,x,y,w,h,opts){
    const count=opts.count||8;
    const cols=Math.max(1, Math.min(2, opts.cols||2));
    const colW=w/cols;
    const rowH=58;
    const startY=y+6;
    for(let i=0;i<count;i++){
      const col=i%cols, row=Math.floor(i/cols);
      const cx=x+col*colW, cy=startY+row*rowH;
      if(cy+rowH>y+h) break;
      const cardX=cx+6, cardY=cy, cardW=colW-12, cardH=rowH-8;
      ctx.fillStyle='#faf7f2'; ctx.strokeStyle='#e5d8cb'; ctx.lineWidth=1;
      roundRect(ctx,cardX,cardY,cardW,cardH,8,true,true);
      ctx.fillStyle='#7c2e4d'; ctx.font='800 9px "Assistant",Arial'; ctx.textAlign='right';
      ctx.fillText((i+1)+'.', cardX+cardW-8, cardY+12);
      // יצירת סדרה
      let seq=[], missingIdx;
      const type = opts.seqType==='mixed' ? ['add','sub','mul'][randInt(0,2)] : opts.seqType;
      if(type==='add'){
        const start=randInt(1,20), step=randInt(2,8);
        seq=Array.from({length:6},(_,k)=> start + k*step);
      } else if(type==='sub'){
        const start=randInt(30,60), step=randInt(2,7);
        seq=Array.from({length:6},(_,k)=> start - k*step);
      } else if(type==='mul'){
        const start=randInt(2,5), ratio=2;
        seq=[start]; for(let k=1;k<6;k++) seq.push(seq[k-1]*ratio);
        if(seq[5]>200){ seq=[2,4,8,16,32,64]; }
      }
      missingIdx=randInt(2,5);
      const missVal=seq[missingIdx];
      // ציור הסדרה
      ctx.textAlign='center';
      const startX=cardX+18, endX=cardX+cardW-18, totalW=endX-startX;
      const stepW= totalW / seq.length;
      ctx.font='700 13px "Assistant",Arial';
      seq.forEach((v, idx)=>{
        const nx=startX + idx*stepW + stepW/2;
        const ny=cardY+28;
        if(idx===missingIdx){
          // ריבוע ריק
          ctx.strokeStyle='#7c2e4d'; ctx.lineWidth=1.2; ctx.setLineDash([3,3]);
          ctx.strokeRect(nx-18, ny-14, 36, 22);
          ctx.setLineDash([]);
          ctx.fillStyle='#7c2e4d'; ctx.font='700 10px "Assistant",Arial'; ctx.fillText('?', nx, ny);
        } else {
          ctx.fillStyle='#1f2328'; ctx.font='700 13px "Assistant",Arial'; ctx.fillText(String(v), nx, ny);
        }
        // פסיק/חץ בין איברים
        if(idx<seq.length-1){
          ctx.fillStyle='#9ca3af'; ctx.font='600 10px Arial'; ctx.fillText('→', nx+stepW/2, ny);
        }
      });
      // שורה תחתונה: קו תשובה
      ctx.fillStyle='#9ca3af'; ctx.font='400 8px "Assistant",Arial'; ctx.textAlign='center';
      ctx.fillText('התשובה: ________', cardX+cardW/2, cardY+cardH-8);
    }
  }

  // ---- שעון ----
  function drawClock(ctx,x,y,w,h,opts){
    const n=opts.clockCount||6;
    const cols=3, cellW=w/cols, rowH=160;
    let idx=0;
    for(let r=0;r<3;r++){
      for(let c=0;c<cols;c++){
        if(idx>=n) break;
        const cx=x + c*cellW, cy=y + r*rowH + 6;
        const cardX=cx+6, cardY=cy, cardW=cellW-12, cardH=rowH-12;
        if(cardY+cardH>y+h) break;
        ctx.fillStyle='#faf7f2'; ctx.strokeStyle='#e5d8cb'; ctx.lineWidth=1;
        roundRect(ctx,cardX,cardY,cardW,cardH,10,true,true);
        // שעון
        const centerX=cardX+cardW/2, centerY=cardY+56, radius=44;
        ctx.fillStyle='#ffffff'; ctx.strokeStyle='#1f2328'; ctx.lineWidth=2;
        ctx.beginPath(); ctx.arc(centerX, centerY, radius, 0, Math.PI*2); ctx.fill(); ctx.stroke();
        // מספרים
        ctx.fillStyle='#1f2328'; ctx.font='700 8px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
        for(let hnum=1; hnum<=12; hnum++){
          const ang=(hnum*30 -90)*Math.PI/180;
          const nx=centerX + Math.cos(ang)*(radius-10);
          const ny=centerY + Math.sin(ang)*(radius-10);
          ctx.fillText(String(hnum), nx, ny);
        }
        // שעה רנדומלית
        const hour=randInt(1,12), minute = Math.random()<0.5?0:30;
        const hourAng = (hour%12)*30 + minute*0.5 -90;
        const minAng = minute*6 -90;
        // מחוג שעה
        ctx.strokeStyle='#7c2e4d'; ctx.lineWidth=3; ctx.lineCap='round';
        ctx.beginPath(); ctx.moveTo(centerX,centerY); ctx.lineTo(centerX+Math.cos(hourAng*Math.PI/180)*24, centerY+Math.sin(hourAng*Math.PI/180)*24); ctx.stroke();
        // מחוג דקה
        ctx.strokeStyle='#1f2328'; ctx.lineWidth=2;
        ctx.beginPath(); ctx.moveTo(centerX,centerY); ctx.lineTo(centerX+Math.cos(minAng*Math.PI/180)*34, centerY+Math.sin(minAng*Math.PI/180)*34); ctx.stroke();
        // מרכז
        ctx.fillStyle='#7c2e4d'; ctx.beginPath(); ctx.arc(centerX,centerY,4,0,Math.PI*2); ctx.fill();
        // קו תשובה
        ctx.strokeStyle='#9ca3af'; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(cardX+18, cardY+cardH-22); ctx.lineTo(cardX+cardW-18, cardY+cardH-22); ctx.stroke();
        ctx.fillStyle='#6b7280'; ctx.font='600 10px "Assistant",Arial'; ctx.textAlign='center'; ctx.fillText('השעה: ___ : ___', centerX, cardY+cardH-10);
        // מספר
        ctx.fillStyle='#7c2e4d'; ctx.font='800 9px "Assistant",Arial'; ctx.textAlign='right'; ctx.fillText((idx+1)+'.', cardX+cardW-8, cardY+12);
        idx++;
      }
    }
  }

  // ---- מנייה ----
  function drawCounting(ctx,x,y,w,h,opts){
    const count=opts.count||8;
    const maxN=parseInt(opts.countingMax||'10',10);
    const cols=2, cellW=w/cols, rowH=92;
    for(let i=0;i<count;i++){
      const col=i%cols, row=Math.floor(i/cols);
      const cx=x+col*cellW, cy=y+row*rowH+4;
      if(cy+rowH>y+h) break;
      const cardX=cx+6, cardY=cy, cardW=cellW-12, cardH=rowH-8;
      ctx.fillStyle='#faf7f2'; ctx.strokeStyle='#e5d8cb'; ctx.lineWidth=1;
      roundRect(ctx,cardX,cardY,cardW,cardH,10,true,true);
      const n=randInt(1,maxN);
      // צייר n עיגולים/כוכבים
      const iconAreaW=cardW-20, iconAreaH=48;
      const startX=cardX+10, startY=cardY+18;
      // סידור בשורה
      const perRow = n<=5? n : 5;
      const rowsNeeded = Math.ceil(n/perRow);
      const iconSize = Math.min(18, (iconAreaW- (perRow-1)*6)/perRow);
      const gap=6;
      let drawn=0;
      for(let rr=0; rr<rowsNeeded; rr++){
        const inRow = rr===rowsNeeded-1 ? n - rr*perRow : perRow;
        const totalRowW = inRow*iconSize + (inRow-1)*gap;
        const rowX = cardX + (cardW - totalRowW)/2;
        const rowY = startY + rr*(iconSize+gap) + (rowsNeeded===1? 8:0);
        for(let cc=0; cc<inRow; cc++){
          const ix=rowX + cc*(iconSize+gap) + iconSize/2;
          const iy=rowY + iconSize/2;
          // צייר כוכב/עיגול צבעוני
          const colors=['#7c2e4d','#96661f','#3e6e8c','#3f6a4e','#a6423a'];
          ctx.fillStyle=colors[drawn % colors.length];
          ctx.beginPath(); ctx.arc(ix, iy, iconSize/2 -1, 0, Math.PI*2); ctx.fill();
          // ברק קטן
          ctx.fillStyle='rgba(255,255,255,0.35)';
          ctx.beginPath(); ctx.arc(ix-3, iy-3, 3, 0, Math.PI*2); ctx.fill();
          drawn++;
        }
      }
      // שורת שאלה
      ctx.fillStyle='#1f2328'; ctx.font='700 12px "Assistant",Arial'; ctx.textAlign='center';
      ctx.fillText(`כמה יש?  ___`, cardX+cardW/2, cardY+cardH-10);
      ctx.fillStyle='#7c2e4d'; ctx.font='800 9px "Assistant",Arial'; ctx.textAlign='right';
      ctx.fillText((i+1)+'.', cardX+cardW-8, cardY+12);
    }
  }

  // ---- כלים גנריים ----
  function roundRect(ctx,x,y,w,h,r, fill, stroke){
    ctx.beginPath();
    ctx.moveTo(x+r, y);
    ctx.lineTo(x+w-r, y);
    ctx.quadraticCurveTo(x+w, y, x+w, y+r);
    ctx.lineTo(x+w, y+h-r);
    ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
    ctx.lineTo(x+r, y+h);
    ctx.quadraticCurveTo(x, y+h, x, y+h-r);
    ctx.lineTo(x, y+r);
    ctx.quadraticCurveTo(x, y, x+r, y);
    ctx.closePath();
    if(fill) ctx.fill();
    if(stroke) ctx.stroke();
  }

  // ---- תצוגה מקדימה + הורדה ----
  function copyToPreview(){
    const src=document.getElementById('wsCanvas');
    const dst=document.getElementById('previewCanvas');
    if(!src||!dst) return;
    dst.width=src.width; dst.height=src.height;
    const c=dst.getContext('2d');
    c.clearRect(0,0,dst.width,dst.height);
    c.drawImage(src,0,0);
  }
  function openPreview(){
    copyToPreview();
    openModal('previewModal');
  }
  window.closeModal = window.closeModal || function(id){
    const el=document.getElementById(id);
    if(el){ el.classList.remove('open'); el.style.display='none'; }
  };
  window.openModal = window.openModal || function(id){
    const el=document.getElementById(id);
    if(el){ el.classList.add('open'); el.style.display='flex'; }
  };
  // דריסה עדינה להבטחת תצוגה
  const _openModal = window.openModal;
  window.openModal = function(id){
    const el=document.getElementById(id);
    if(el){ el.classList.add('open'); el.style.display='flex'; el.style.alignItems='center'; el.style.justifyContent='center'; }
    else _openModal(id);
  };

  async function downloadPdf(){
    const canvas=document.getElementById('wsCanvas');
    if(!canvas){ return; }
    const { jsPDF } = window.jspdf || {};
    if(!jsPDF){
      // fallback: הורד כ-PNG
      const a=document.createElement('a');
      a.download=(state.title||'דף_עבודה')+'.png';
      a.href=canvas.toDataURL('image/png');
      a.click();
      return;
    }
    const pdf=new jsPDF({orientation:'p', unit:'pt', format:'a4'});
    const pdfW=pdf.internal.pageSize.getWidth();
    const pdfH=pdf.internal.pageSize.getHeight();
    const imgData=canvas.toDataURL('image/png', 1.0);
    pdf.addImage(imgData, 'PNG', 0, 0, pdfW, pdfH);
    const safe=(state.title||'דף_עבודה').replace(/[\\/:*?"<>|]/g,'_').replace(/\s+/g,'_');
    pdf.save(safe + '.pdf');
    try{ window.showError && window.showError('הקובץ הורד בהצלחה: '+safe+'.pdf'); }catch(e){}
  }

  async function copyImage(){
    const canvas=document.getElementById('wsCanvas');
    if(!canvas) return;
    try{
      const blob= await new Promise(res=> canvas.toBlob(res, 'image/png'));
      if(navigator.clipboard && window.ClipboardItem){
        await navigator.clipboard.write([new ClipboardItem({'image/png': blob})]);
        window.showError && window.showError('התמונה הועתקה ללוח');
      } else {
        const url=URL.createObjectURL(blob);
        window.open(url, '_blank');
      }
    }catch(e){
      const a=document.createElement('a');
      a.href=canvas.toDataURL('image/png');
      a.download='דף_עבודה.png';
      a.click();
    }
  }

  // חשיפה לבדיקות
  window.WS = { TEMPLATES, drawWorksheet, downloadPdf, openPreview, renderLive };

})();
