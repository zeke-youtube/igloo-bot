function normalizeSource(text) { return String(text || '').replace(/\s+/g, ' ').trim(); }
function encode(text) {
  const source = normalizeSource(text); const words = source.split(' ');
  return words.map(word => [...word].map((char, index) => { if (!/[A-Za-z]/.test(char)) return char; const gap = index && /[A-Za-z]/.test(word[index - 1]) ? ' ' : ''; return `${gap}${'a'.repeat(char.toUpperCase().charCodeAt(0) - 64)}`; }).join('')).join('  ');
}
function decode(text) {
  const source = String(text ?? '');
  if (!source) return '';
  if (source.startsWith(' ') || source.endsWith(' ')) throw new TypeError('Invalid PikaScreamingLang.');
  let result = '';
  for (let index = 0; index < source.length;) {
    const char = source[index];
    if (char === ' ') {
      let end = index + 1;
      while (source[end] === ' ') end += 1;
      const count = end - index;
      if (count > 2) throw new TypeError('Invalid PikaScreamingLang.');
      if (count === 2) result += ' ';
      index = end;
      continue;
    }
    if (char === 'a') {
      let end = index + 1;
      while (source[end] === 'a') end += 1;
      const count = end - index;
      if (count > 26) throw new TypeError('Invalid PikaScreamingLang.');
      result += String.fromCharCode(64 + count);
      index = end;
      continue;
    }
    if (/[A-Zb-z]/.test(char)) throw new TypeError('Invalid PikaScreamingLang.');
    result += char;
    index += 1;
  }
  return result;
}
function isUsable(text, maxLength = 1800) { const source = normalizeSource(text); if (source.length < 12 || encode(source).length > maxLength) return false; const letters = (source.match(/[A-Za-z]/g) || []).length; return letters >= 8 && letters / Math.max(source.replace(/\s/g, '').length, 1) >= 0.55 && !/[{}<>]|\[\[|\]\]|\{\{|}}|&(?:amp|lt|gt);/.test(source); }
module.exports = { normalizeSource, encode, decode, isUsable };
