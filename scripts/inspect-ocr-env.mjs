import fs from 'node:fs';

const raw = fs.readFileSync('e:/Programming/Sites/RST/.env');
const bom = raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf;
const text = raw.toString('utf8').replace(/^\uFEFF/, '');
const lines = text.split(/\r?\n/);

function inspect(name) {
  const line = lines.find((l) => l.startsWith(`${name}=`) || l.startsWith(`${name} =`));
  if (!line) return { name, present: false };
  const val = line.slice(line.indexOf('=') + 1);
  const quoted =
    (val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"));
  const unquoted = quoted ? val.slice(1, -1) : val;
  return {
    name,
    present: true,
    empty: unquoted.trim() === '',
    length: unquoted.length,
    quoted,
    leadingSpace: val.startsWith(' ') || val.startsWith('\t'),
    trailingSpace: /\s$/.test(val),
    hasSpacesInside: /\s/.test(unquoted.trim()),
    looksLikePlaceholder: /your_|changeme|xxx|TODO|встав|example/i.test(unquoted),
  };
}

console.log(
  JSON.stringify(
    {
      bom,
      ocr: inspect('OCR_API_KEY'),
      gemini: inspect('GEMINI_API_KEY'),
      provider: inspect('OCR_PROVIDER'),
    },
    null,
    2,
  ),
);
