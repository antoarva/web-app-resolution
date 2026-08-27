/**
 * Monaco language support for IDF.
 *
 * IDF has no official editor grammar, so this defines one: comments run from
 * `!` to end of line, objects are comma-delimited and semicolon-terminated, and
 * the first token of an object is its class. Completion is driven by the same
 * IDD subset the form editors use, so both views agree on what a field means.
 */

import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { allClasses, getClassSchema, fieldAt } from '@/core/idd/schema';

export const IDF_LANGUAGE_ID = 'idf';

export function registerIdfLanguage(monaco: typeof Monaco): void {
  // Guard against double registration under React strict mode.
  if (monaco.languages.getLanguages().some((language) => language.id === IDF_LANGUAGE_ID)) return;

  monaco.languages.register({ id: IDF_LANGUAGE_ID, extensions: ['.idf', '.imf'], aliases: ['IDF', 'EnergyPlus'] });

  monaco.languages.setLanguageConfiguration(IDF_LANGUAGE_ID, {
    comments: { lineComment: '!' },
    brackets: [],
    autoClosingPairs: [],
    // Fold each object: from the class line down to its terminating semicolon.
    folding: {
      markers: {
        start: /^\s*!-\s*=+.*=+\s*$/,
        end: /^\s*$/,
      },
    },
  });

  const classNames = allClasses().map((entry) => entry.name);

  monaco.languages.setMonarchTokensProvider(IDF_LANGUAGE_ID, {
    defaultToken: '',
    ignoreCase: true,
    knownClasses: classNames,
    keywords: [
      'Yes', 'No', 'Autosize', 'Autocalculate', 'Outdoors', 'Ground', 'Adiabatic',
      'Surface', 'Zone', 'SunExposed', 'NoSun', 'WindExposed', 'NoWind',
      'Wall', 'Roof', 'Ceiling', 'Floor', 'Window', 'Door', 'GlassDoor',
      'Through', 'For', 'Until', 'AllDays', 'Weekdays', 'Weekends',
      'Saturday', 'Sunday', 'AllOtherDays', 'Holiday',
    ],
    tokenizer: {
      root: [
        // Banner comments the serialiser writes between groups.
        [/^\s*!-\s*=+.*$/, 'comment.doc'],
        [/!.*$/, 'comment'],
        // A class name is the first token on a line, ending in a comma.
        [/^\s*([A-Za-z][\w:]*)(?=\s*,)/, {
          cases: { '$1@knownClasses': 'type.identifier', '@default': 'entity.name.class' },
        }],
        [/^\s*([A-Za-z][\w:]*)(?=\s*;)/, {
          cases: { '$1@knownClasses': 'type.identifier', '@default': 'entity.name.class' },
        }],
        [/-?\d+\.?\d*([eE][-+]?\d+)?/, 'number'],
        [/[A-Za-z_][\w\-. /]*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
        [/[,;]/, 'delimiter'],
      ],
    },
  } as Monaco.languages.IMonarchLanguage);

  // --- Completion ---
  monaco.languages.registerCompletionItemProvider(IDF_LANGUAGE_ID, {
    triggerCharacters: [',', '\n'],
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range: Monaco.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const context = objectContextAt(model, position);

      // At the start of a new object, suggest class names as full snippets.
      if (!context) {
        return {
          suggestions: allClasses().map((entry) => ({
            label: entry.name,
            kind: monaco.languages.CompletionItemKind.Class,
            detail: entry.group,
            documentation: { value: entry.memo },
            insertText: buildSnippet(entry.name),
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range,
          })),
        };
      }

      // Inside an object, suggest the values valid for the current field.
      const schema = getClassSchema(context.className);
      const field = schema ? fieldAt(schema, context.fieldIndex) : undefined;
      if (!field) return { suggestions: [] };

      const suggestions: Monaco.languages.CompletionItem[] = [];
      for (const choice of field.choices ?? []) {
        if (!choice) continue;
        suggestions.push({
          label: choice,
          kind: monaco.languages.CompletionItemKind.EnumMember,
          detail: field.name,
          insertText: choice,
          range,
        });
      }
      if (field.autosizable) {
        suggestions.push({
          label: 'autosize',
          kind: monaco.languages.CompletionItemKind.Constant,
          detail: `${field.name} — let EnergyPlus size this`,
          insertText: 'autosize',
          range,
        });
      }
      if (field.default) {
        suggestions.push({
          label: field.default,
          kind: monaco.languages.CompletionItemKind.Value,
          detail: `${field.name} — default`,
          insertText: field.default,
          range,
        });
      }
      return { suggestions };
    },
  });

  // --- Hover: explain the field under the cursor ---
  monaco.languages.registerHoverProvider(IDF_LANGUAGE_ID, {
    provideHover(model, position) {
      const context = objectContextAt(model, position);
      if (!context) {
        // On a class-name line, describe the class itself.
        const lineText = model.getLineContent(position.lineNumber).trim();
        const match = /^([A-Za-z][\w:]*)\s*[,;]/.exec(lineText);
        const schema = match ? getClassSchema(match[1]) : undefined;
        if (!schema) return null;
        return {
          contents: [
            { value: `**${schema.name}** — _${schema.group}_` },
            { value: schema.memo },
          ],
        };
      }

      const schema = getClassSchema(context.className);
      const field = schema ? fieldAt(schema, context.fieldIndex) : undefined;
      if (!schema || !field) return null;

      const lines = [`**${field.name}**${field.units ? ` \`${field.units}\`` : ''}`];
      lines.push(`Field ${context.fieldIndex + 1} of ${schema.name}`);
      if (field.note) lines.push(field.note);
      if (field.choices?.length) lines.push(`Allowed: ${field.choices.filter(Boolean).join(', ')}`);
      if (field.default) lines.push(`Default: \`${field.default}\``);
      if (field.minimum !== undefined || field.maximum !== undefined) {
        lines.push(`Range: ${field.minimum ?? '−∞'} to ${field.maximum ?? '∞'}`);
      }
      return { contents: lines.map((value) => ({ value })) };
    },
  });
}

interface ObjectContext {
  className: string;
  /** Zero-based index of the field the cursor sits in. */
  fieldIndex: number;
}

/**
 * Walks backwards from the cursor to the start of the current object,
 * counting field separators. Returns null when the cursor is between objects.
 */
function objectContextAt(
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
): ObjectContext | null {
  let fieldIndex = -1;
  let className: string | null = null;

  for (let line = position.lineNumber; line >= 1; line--) {
    let text = model.getLineContent(line);
    if (line === position.lineNumber) text = text.slice(0, position.column - 1);

    const commentAt = text.indexOf('!');
    if (commentAt >= 0) text = text.slice(0, commentAt);

    // A semicolon above the cursor means the previous object already closed.
    if (line < position.lineNumber && text.includes(';')) return null;

    const commas = (text.match(/,/g) ?? []).length;
    fieldIndex += commas;

    const classMatch = /^\s*([A-Za-z][\w:]*)\s*,/.exec(text);
    if (classMatch) {
      className = classMatch[1];
      break;
    }
    if (line === 1) break;
  }

  if (!className || fieldIndex < 0) return null;
  return { className, fieldIndex };
}

/** A tab-through snippet with every field of a class laid out and annotated. */
function buildSnippet(className: string): string {
  const schema = getClassSchema(className);
  if (!schema) return `${className},\n  \${1};`;

  const lines = [`${className},`];
  schema.fields.forEach((field, index) => {
    const isLast = index === schema.fields.length - 1;
    const placeholder = `\${${index + 1}:${field.default ?? ''}}`;
    const value = `  ${placeholder}${isLast ? ';' : ','}`;
    const label = field.units ? `${field.name} {${field.units}}` : field.name;
    lines.push(`${value.padEnd(32)}!- ${label}`);
  });
  return lines.join('\n');
}

/** Editor themes matching the app's design tokens. */
export function defineIdfThemes(monaco: typeof Monaco): void {
  monaco.editor.defineTheme('envelop-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '64748b', fontStyle: 'italic' },
      { token: 'comment.doc', foreground: '0369a1', fontStyle: 'bold' },
      { token: 'type.identifier', foreground: '7c3aed', fontStyle: 'bold' },
      { token: 'entity.name.class', foreground: 'be185d', fontStyle: 'bold' },
      { token: 'number', foreground: '0f766e' },
      { token: 'keyword', foreground: 'b45309' },
      { token: 'delimiter', foreground: '94a3b8' },
    ],
    colors: {
      'editor.background': '#ffffff',
      'editorLineNumber.foreground': '#94a3b8',
      'editor.lineHighlightBackground': '#f1f5f9',
      'editor.selectionBackground': '#bae6fd',
    },
  });

  monaco.editor.defineTheme('envelop-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '64748b', fontStyle: 'italic' },
      { token: 'comment.doc', foreground: '38bdf8', fontStyle: 'bold' },
      { token: 'type.identifier', foreground: 'c4b5fd', fontStyle: 'bold' },
      { token: 'entity.name.class', foreground: 'f9a8d4', fontStyle: 'bold' },
      { token: 'number', foreground: '5eead4' },
      { token: 'keyword', foreground: 'fbbf24' },
      { token: 'delimiter', foreground: '64748b' },
    ],
    colors: {
      'editor.background': '#0b1220',
      'editorLineNumber.foreground': '#475569',
      'editor.lineHighlightBackground': '#111c2e',
      'editor.selectionBackground': '#1e40af',
    },
  });
}
