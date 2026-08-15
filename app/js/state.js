/* ============================================================
   state.js — global constants + in-memory app state.
   Loaded first; every other app/js/*.js file reads/writes these
   globals directly (plain scripts, no bundler/modules, same
   pattern as the original single-file app).
   ============================================================ */

// Google Apps Script relay endpoint — unchanged from the original app.
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzxvV8ZLanAMgXOCP1BhDkS8lIhTndTOyYHBLbGos489440StiYDlxq4ckWcdtDJTfa/exec';

const MAX_BATCH_SIZE_MB = 23;      // per-email attachment batch cap
const DRIVE_THRESHOLD_MB = 23;     // above this -> upload to Drive instead of attaching
const LARGE_FILE_THRESHOLD_MB = 25; // above this -> flagged "large" in the UI

if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = '../libs/pdf.worker.min.js';
}

// Keys that belong to a "sending style" (quantity/format/branding/etc.) —
// shared by per-file settings, group settings and the style manager.
const STYLE_KEYS = [
    'quantity', 'format', 'convertToPdf', 'addPageNumbers', 'addArrows', 'addBsd',
    'addLogo', 'reverseLastPage', 'duplicateTwoUp', 'addEvenBlankPage', 'compressPdf',
    'splitFile', 'sendSecondary', 'secondaryEmail', 'isPlusSelected', 'marginCut', 'multiUpMode'
];

// ---- in-memory state ----
let filesData = [];             // [{ fileObj, id, group, quantity, format, ... }]
let currentFolderName = '';     // used for the instructions .txt filename/header
let currentMergeGroup = 0;      // which group (1-4) the merge sidebar is showing
let currentView = 'grid';       // 'grid' | 'list'
let wakeLock = null;
let customPageOrders = {};      // { groupKey: [ {type:'page', fileId, pageIndex} | {type:'blank'} ] }
let logDirectoryHandle = null;  // optional File System Access API handle for local log files

let pageSorterState = {
    group: 0,
    sourceFiles: [],   // [{ fileItem, pages: [{pageIndex, thumbnail}] }]
    finalOrder: []     // [{ type:'page'|'blank', fileId, pageIndex, thumbnail, originalFileName }]
};

let currentSelectionFileId = null;
let currentSelectionTotalPages = 0;
