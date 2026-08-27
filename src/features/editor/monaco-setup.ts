/**
 * Monaco bootstrap.
 *
 * Two things here exist for the offline requirement:
 *
 * 1. The default Monaco loader fetches its worker from a CDN. Importing the
 *    worker with Vite's `?worker` suffix bundles it locally instead, and
 *    `MonacoEnvironment` points Monaco at that copy.
 * 2. The `monaco-editor` package entry pulls in every bundled language —
 *    TypeScript, SQL, ABAP and eighty others — which is several megabytes of
 *    dead weight for an app whose only language is IDF. Importing the bare
 *    editor API and then opting into just the editor features actually used
 *    keeps the chunk to what this app needs.
 */

import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';

// Editor features. Each import registers a contribution; without them the
// editor still renders but has no suggestions, hover, find or folding.
import 'monaco-editor/esm/vs/editor/contrib/hover/browser/hoverContribution.js';
import 'monaco-editor/esm/vs/editor/contrib/suggest/browser/suggestController.js';
import 'monaco-editor/esm/vs/editor/contrib/find/browser/findController.js';
import 'monaco-editor/esm/vs/editor/contrib/folding/browser/folding.js';
import 'monaco-editor/esm/vs/editor/contrib/comment/browser/comment.js';
import 'monaco-editor/esm/vs/editor/contrib/contextmenu/browser/contextmenu.js';
import 'monaco-editor/esm/vs/editor/contrib/clipboard/browser/clipboard.js';
import 'monaco-editor/esm/vs/editor/contrib/cursorUndo/browser/cursorUndo.js';
import 'monaco-editor/esm/vs/editor/contrib/multicursor/browser/multicursor.js';
import 'monaco-editor/esm/vs/editor/contrib/wordHighlighter/browser/wordHighlighter.js';
import 'monaco-editor/esm/vs/editor/contrib/bracketMatching/browser/bracketMatching.js';
import 'monaco-editor/esm/vs/editor/contrib/linesOperations/browser/linesOperations.js';
import 'monaco-editor/esm/vs/editor/contrib/indentation/browser/indentation.js';
import 'monaco-editor/esm/vs/editor/contrib/wordOperations/browser/wordOperations.js';

import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import { registerIdfLanguage, defineIdfThemes } from './idf-language';

let initialised = false;

export function setupMonaco(): typeof monaco {
  if (!initialised) {
    self.MonacoEnvironment = {
      getWorker() {
        return new EditorWorker();
      },
    };
    registerIdfLanguage(monaco);
    defineIdfThemes(monaco);
    initialised = true;
  }
  return monaco;
}

export type { monaco };
