import { useEffect, useRef, useState, useMemo } from 'react';
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';
import * as Icons from 'lucide-react';
import { setupMonaco } from './monaco-setup';
import { IDF_LANGUAGE_ID } from './idf-language';
import { useModelStore } from '@/store/model-store';
import { useUiStore } from '@/store/ui-store';
import { Button, Badge } from '@/components/ui/primitives';
import { serializeModel } from '@/core/idf/serialize';
import { debounce, cn, formatBytes } from '@/lib/utils';

/** Text view of the IDF file, kept in sync with the object model. */
export function EditorView() {
  const host = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor>();
  /** Suppresses the change handler while we write the model back into Monaco. */
  const applyingExternal = useRef(false);

  const source = useModelStore((state) => state.source);
  const setSource = useModelStore((state) => state.setSource);
  const model = useModelStore((state) => state.model);
  const issues = useModelStore((state) => state.issues);
  const selection = useModelStore((state) => state.selection);

  const dark = useUiStore((state) => state.resolvedTheme === 'dark');
  const fontSize = useUiStore((state) => state.editorFontSize);
  const setFontSize = useUiStore((state) => state.setEditorFontSize);

  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const [wordWrap, setWordWrap] = useState(false);

  // --- Create the editor once ---
  useEffect(() => {
    const container = host.current;
    if (!container) return;

    const monaco = setupMonaco();
    const editor = monaco.editor.create(container, {
      value: useModelStore.getState().source,
      language: IDF_LANGUAGE_ID,
      theme: dark ? 'envelop-dark' : 'envelop-light',
      fontSize,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      minimap: { enabled: true, maxColumn: 80 },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      renderWhitespace: 'none',
      tabSize: 2,
      wordWrap: 'off',
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      padding: { top: 10, bottom: 40 },
      bracketPairColorization: { enabled: false },
      suggest: { showWords: false },
      quickSuggestions: { other: true, comments: false, strings: false },
    });
    editorRef.current = editor;

    // Debounced so a re-parse does not run on every keystroke.
    const pushSource = debounce((value: string) => {
      void setSource(value);
    }, 400);

    const changeSubscription = editor.onDidChangeModelContent(() => {
      if (applyingExternal.current) return;
      pushSource(editor.getValue());
    });

    const cursorSubscription = editor.onDidChangeCursorPosition((event) => {
      setCursor({ line: event.position.lineNumber, column: event.position.column });
    });

    return () => {
      pushSource.cancel();
      changeSubscription.dispose();
      cursorSubscription.dispose();
      editor.dispose();
    };
    // Created once; theme and font are applied by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Push external source changes (template load, form edits) into Monaco ---
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || editor.getValue() === source) return;

    applyingExternal.current = true;
    const position = editor.getPosition();
    editor.setValue(source);
    if (position) editor.setPosition(position);
    applyingExternal.current = false;
  }, [source]);

  useEffect(() => {
    const monaco = setupMonaco();
    monaco.editor.setTheme(dark ? 'envelop-dark' : 'envelop-light');
  }, [dark]);

  useEffect(() => {
    editorRef.current?.updateOptions({ fontSize, wordWrap: wordWrap ? 'on' : 'off' });
  }, [fontSize, wordWrap]);

  // --- Surface parse issues as editor markers ---
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = setupMonaco();
    const textModel = editor?.getModel();
    if (!textModel) return;

    const markers: Monaco.editor.IMarkerData[] = issues
      .filter((issue) => issue.severity !== 'info')
      .map((issue) => {
        // Issues are object-scoped, so anchor each marker on its class line.
        const target = issue.objectId
          ? model.objects.find((object) => object.id === issue.objectId)
          : undefined;
        const searchTerm = target ? `${target.className},` : issue.className ?? '';
        const match = searchTerm
          ? textModel.findMatches(searchTerm, true, false, false, null, false, 1)[0]
          : undefined;
        const line = match?.range.startLineNumber ?? 1;

        return {
          severity: issue.severity === 'error'
            ? monaco.MarkerSeverity.Error
            : monaco.MarkerSeverity.Warning,
          message: issue.message,
          startLineNumber: line,
          endLineNumber: line,
          startColumn: 1,
          endColumn: textModel.getLineMaxColumn(line),
        };
      });

    monaco.editor.setModelMarkers(textModel, 'envelop', markers);
  }, [issues, model]);

  // --- Reveal the object selected elsewhere in the app ---
  useEffect(() => {
    const editor = editorRef.current;
    const textModel = editor?.getModel();
    if (!editor || !textModel || !selection.objectId) return;

    const target = model.objects.find((object) => object.id === selection.objectId);
    if (!target) return;

    const name = target.fields[0]?.trim();
    // Search on the name when there is one; it is far more specific than the class.
    const term = name ? name : `${target.className},`;
    const match = textModel.findMatches(term, true, false, false, null, false, 1)[0];
    if (!match) return;

    editor.revealRangeInCenterIfOutsideViewport(match.range);
    editor.setSelection(match.range);
  }, [selection.objectId, model]);

  const format = (): void => {
    void setSource(serializeModel(useModelStore.getState().model));
  };

  const errorCount = issues.filter((issue) => issue.severity === 'error').length;
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
  const byteSize = useMemo(() => new Blob([source]).size, [source]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-muted/40 px-3 text-xs">
        <Icons.FileCode className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        <span className="font-medium">input.idf</span>
        <span className="text-muted-foreground tabular">{formatBytes(byteSize)}</span>

        {errorCount > 0 && <Badge tone="danger">{errorCount} error{errorCount === 1 ? '' : 's'}</Badge>}
        {warningCount > 0 && <Badge tone="warning">{warningCount} warning{warningCount === 1 ? '' : 's'}</Badge>}
        {errorCount === 0 && warningCount === 0 && <Badge tone="success">valid</Badge>}

        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={format} title="Rewrite the file with aligned field comments">
            <Icons.AlignLeft className="h-3.5 w-3.5" aria-hidden />
            Format
          </Button>
          <Button
            variant="ghost" size="icon"
            onClick={() => setWordWrap(!wordWrap)}
            title={wordWrap ? 'Disable word wrap' : 'Enable word wrap'}
            className={cn(wordWrap && 'text-primary')}
          >
            <Icons.WrapText className="h-3.5 w-3.5" aria-hidden />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setFontSize(fontSize - 1)} title="Smaller text">
            <Icons.Minus className="h-3.5 w-3.5" aria-hidden />
          </Button>
          <span className="w-6 text-center text-[11px] text-muted-foreground tabular">{fontSize}</span>
          <Button variant="ghost" size="icon" onClick={() => setFontSize(fontSize + 1)} title="Larger text">
            <Icons.Plus className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <div ref={host} className="monaco-host" />
      </div>

      <div className="flex h-6 shrink-0 items-center gap-3 border-t border-border bg-muted/40 px-3 text-[11px] text-muted-foreground">
        <span className="tabular">Ln {cursor.line}, Col {cursor.column}</span>
        <span className="tabular">{model.objects.length} objects</span>
        <span className="ml-auto">IDF · EnergyPlus</span>
      </div>
    </div>
  );
}
