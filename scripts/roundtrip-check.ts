import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseXmlTags, serializeXmlTag, type XmlTag } from '../src/shared/xml-tags.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(__dirname, '../src/client/tiptap/markdown/__fixtures__/roundtrip.md');

const input = readFileSync(fixturePath, 'utf8');
const tags = parseXmlTags(input);

let output = '';
let cursor = 0;
for (const t of tags) {
  output += input.slice(cursor, t.start);
  output += serializeXmlTag(t.kind, t.attrs);
  cursor = t.end;
}
output += input.slice(cursor);

const match = output === input;

console.log(`Parsed ${tags.length} XML tags.`);
for (const t of tags) {
  console.log(`  line ${t.line.toString().padStart(3)}  ${t.kind.padEnd(18)} ${JSON.stringify(t.attrs)}`);
}

if (match) {
  console.log('\n✓ Roundtrip stable — output matches fixture byte-for-byte.');
  process.exit(0);
}

console.log('\n✗ Roundtrip mismatch. Diff:');
const inLines = input.split('\n');
const outLines = output.split('\n');
const max = Math.max(inLines.length, outLines.length);
for (let i = 0; i < max; i++) {
  if (inLines[i] !== outLines[i]) {
    console.log(`  line ${i + 1}:`);
    console.log(`    in : ${JSON.stringify(inLines[i])}`);
    console.log(`    out: ${JSON.stringify(outLines[i])}`);
  }
}
process.exit(1);
