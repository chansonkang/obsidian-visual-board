import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';
import { WorkerMessageHandler } from 'pdfjs-dist/build/pdf.worker.mjs';
// The isolated frame has no external scripts or worker URLs. PDF.js uses its bundled handler.
globalThis.pdfjsWorker = { WorkerMessageHandler };
window.VBPDF = pdfjs;
