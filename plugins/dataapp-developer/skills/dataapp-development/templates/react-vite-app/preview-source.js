// Dev-only stand-in for `react/jsx-dev-runtime`, served by vite.config.ts in place of React's.
// - Stamps each HTML element with `data-kai-source="src/File.tsx:line:column"`, where its JSX is written.
// - preview-picker.js reads it, so a part picked in Keboola's app preview names its place in the code.
// - `ROOT` (the Vite root, with a trailing slash) is prepended by vite.config.ts.
import { Fragment, jsxDEV as reactJsxDEV } from 'react/jsx-dev-runtime';

export { Fragment };

export function jsxDEV(type, props, key, isStaticChildren, source, self) {
  if (typeof type === 'string' && source && source.fileName && props && !('data-kai-source' in props)) {
    // Compiled JSX hands over a fresh props object, so it is stamped in place.
    var file = source.fileName.indexOf(ROOT) === 0 ? source.fileName.slice(ROOT.length) : source.fileName;
    props['data-kai-source'] = file + ':' + source.lineNumber + ':' + source.columnNumber;
  }
  return reactJsxDEV(type, props, key, isStaticChildren, source, self);
}
