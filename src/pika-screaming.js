function normalizeSource(text) { return String(text || '').replace(/\s+/g, ' ').trim(); }
function encode(text) {
  const source = normalizeSource(text); const words = source.split(' ');
  return words.map(word => [...word].map((char, index) => { if (!/[A-Za-z]/.test(char)) return char; const gap = index && /[A-Za-z]/.test(word[index - 1]) ? ' ' : ''; return `${gap}${'a'.repeat(char.toUpperCase().charCodeAt(0) - 64)}`; }).join('')).join('  ');
}
function isUsable(text, maxLength = 1800) { const source = normalizeSource(text); if (source.length < 12 || encode(source).length > maxLength) return false; const letters = (source.match(/[A-Za-z]/g) || []).length; return letters >= 8 && letters / Math.max(source.replace(/\s/g, '').length, 1) >= 0.55 && !/[{}<>]|\[\[|\]\]|\{\{|}}|&(?:amp|lt|gt);/.test(source); }
module.exports = { normalizeSource, encode, isUsable };
