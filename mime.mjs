// Strict HTTP media-type syntax; no dependencies and no raw parameters in diagnostics.
const punctuation = "!#$%&'*+-.^_`|~";
const tokenChar = (c) =>
  !!c && (/[A-Za-z0-9]/.test(c) || punctuation.includes(c));
export function normalizeMime(value) {
  if (
    typeof value !== 'string' ||
    value.length > 1024 ||
    /[\x00-\x08\x0a-\x1f\x7f]/.test(value)
  )
    return null;
  let i = 0;
  const ows = () => {
    while (value[i] === ' ' || value[i] === '\t') i++;
  };
  const token = () => {
    const start = i;
    while (tokenChar(value[i])) i++;
    return value.slice(start, i);
  };
  ows();
  const type = token();
  if (!type || type.length > 127 || value[i++] !== '/') return null;
  const subtype = token();
  if (!subtype || subtype.length > 127) return null;
  ows();
  const names = new Set();
  while (i < value.length) {
    if (value[i++] !== ';') return null;
    ows();
    const name = token().toLowerCase();
    if (!name || names.has(name) || value[i++] !== '=') return null;
    names.add(name);
    if (value[i] === '"') {
      i++;
      let closed = false;
      while (i < value.length) {
        const c = value[i++];
        if (c === '"') {
          closed = true;
          break;
        }
        if (c === '\\') {
          if (i >= value.length) return null;
          const escaped = value.charCodeAt(i++);
          if (escaped < 32 || escaped > 126) return null;
        } else if (c.charCodeAt(0) < 32 || c.charCodeAt(0) > 126) return null;
      }
      if (!closed) return null;
    } else if (!token()) return null;
    ows();
  }
  return (type + '/' + subtype).toLowerCase();
}
