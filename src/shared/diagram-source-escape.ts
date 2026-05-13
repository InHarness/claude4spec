export function escapeDiagramSource(source: string): string {
  return source
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function unescapeDiagramSource(escaped: string): string {
  return escaped
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&#13;/g, '\r')
    .replace(/&#10;/g, '\n')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}
