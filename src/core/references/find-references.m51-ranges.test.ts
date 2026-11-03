import { describe, expect, it } from 'vitest';
import { findReferences } from './find-references.js';
import type { FindReferencesDeps } from './types.js';

/**
 * M51 2.1.65 — non-content ranges as `find_references` sees them: inline code
 * pairs only within an inline block, run length matters, GFM pipes in tables,
 * the indented block is code, an unclosed fence ends with its container, the
 * earlier construct wins, and unknown JSX regions are block regions counted in
 * their container, inline regions bounded by their inline block, and nothing
 * for an unpaired opening.
 */

const tag = (slug: string) => `<inline_mention type="ac" slug="${slug}"/>`;

/** Slugs of `ac` entities `find_references` returns from one page body. */
async function seen(body: string, ...slugs: string[]): Promise<string[]> {
  const deps: FindReferencesDeps = {
    pages: { listPages: async () => [{ rootId: 'pages', path: 'p.md', body }] },
    host: { entityExists: () => true },
    getEntityTagSlugs: () => [],
  };
  const out: string[] = [];
  for (const slug of slugs) {
    const hits = await findReferences(deps, 'ac', slug);
    if (hits.length > 0) out.push(slug);
  }
  return out;
}

describe('M51 — inline code pairs only inside one inline block', () => {
  it('[ac:m51-backtick-escaped-not-opener] a tag after an escaped \\` and before a backtick pair in the same paragraph is seen', async () => {
    const body = `Literal \\\` then ${tag('live')} and a \`pair\` later.\n`;
    expect(await seen(body, 'live')).toEqual(['live']);
    // Control: without the backslash the first backtick opens code over the tag.
    const control = `Literal \` then ${tag('coded')} and a \`pair\` later.\n`;
    expect(await seen(control, 'coded')).toEqual([]);
  });

  it('[ac:m51-backtick-inside-html-tag-not-opener] a tag after <a title="`"> and before a later backtick in the same paragraph is seen', async () => {
    const body = `See <a title="\`">link</a> then ${tag('live')} and a lone \` here.\n`;
    expect(await seen(body, 'live')).toEqual(['live']);
  });

  it('[ac:m51-backtick-run-length-must-match] a tag between a single backtick and a double run in the same paragraph is seen', async () => {
    const body = `One \` tick, then ${tag('live')}, then two \`\` ticks.\n`;
    expect(await seen(body, 'live')).toEqual(['live']);
  });

  it('[ac:m51-backtick-unpaired-stays-in-paragraph] a tag in the paragraph after one with an unpaired backtick is seen', async () => {
    const body = `First paragraph with a lone \` tick.\n\nSecond ${tag('live')} with another \` tick.\n`;
    expect(await seen(body, 'live')).toEqual(['live']);
  });

  it('[ac:m51-backtick-unpaired-stays-in-list-item] a tag in the list item after one with an unpaired backtick is seen', async () => {
    const body = `- first item with a lone \` tick\n- second ${tag('live')} with another \` tick\n`;
    expect(await seen(body, 'live')).toEqual(['live']);
  });

  it('[ac:m51-caption-backtick-single-resolved] a lone backtick in caption keeps the tag even with another backtick later in the same inline block', async () => {
    const body =
      `<single_element type="ac" slug="captioned" caption="the \` key"/> is described, ` +
      `and later in this paragraph a lone \` stands.\n`;
    expect(await seen(body, 'captioned')).toEqual(['captioned']);
  });
});

describe('M51 — GFM pipes in a table row', () => {
  it('[ac:m51-table-pipe-splits-code-span] a tag in a cell after a cell with an unpaired backtick is seen', async () => {
    const body = `| a | b |\n| --- | --- |\n| lone \` tick | ${tag('live')} \` more |\n`;
    expect(await seen(body, 'live')).toEqual(['live']);
  });

  it('[ac:m51-table-escaped-pipe-keeps-code-span] a tag after \\| inside inline code in a table cell is not returned', async () => {
    const body = `| a | b |\n| --- | --- |\n| \`x \\| ${tag('coded')}\` | c |\n`;
    expect(await seen(body, 'coded')).toEqual([]);
  });
});

describe('M51 — code blocks', () => {
  it('[ac:m51-indented-code-block-excluded] a tag in a block indented four spaces is not returned', async () => {
    const body = `Intro.\n\n    ${tag('indented')}\n    more code\n\n${tag('live')} after.\n`;
    expect(await seen(body, 'indented', 'live')).toEqual(['live']);
  });

  it('[ac:m51-fence-unclosed-ends-with-container] a tag in the paragraph after a list whose item opened a fence without closing it is seen', async () => {
    const body = `- item\n  \`\`\`\n  ${tag('fenced')}\n\nAfter the list ${tag('live')}.\n`;
    expect(await seen(body, 'fenced', 'live')).toEqual(['live']);
  });
});

describe('M51 — unknown JSX regions', () => {
  it('[ac:m51-jsx-block-backtick-inside-contained] a lone backtick inside a paired <Callout> block does not hide the tag on the line right below </Callout>', async () => {
    const body = `<Callout>\nA lone \` tick inside.\n</Callout>\n${tag('live')} with a \` tick.\n`;
    expect(await seen(body, 'live')).toEqual(['live']);
  });

  it('[ac:m51-jsx-block-in-blockquote-excluded] a tag inside <Callout> opened after "> " and closed in the same quote past a blank ">" is not returned', async () => {
    const body = `> <Callout>\n>\n> ${tag('inside')}\n>\n> </Callout>\n\n${tag('live')} after.\n`;
    expect(await seen(body, 'inside', 'live')).toEqual(['live']);
  });

  it('[ac:m51-jsx-block-in-list-item-excluded] a tag inside <Callout> opened in a list item and closed in it past a blank line is not returned', async () => {
    const body = `- <Callout>\n\n  ${tag('inside')}\n\n  </Callout>\n\n${tag('live')} after.\n`;
    expect(await seen(body, 'inside', 'live')).toEqual(['live']);
  });

  it('[ac:m51-jsx-earlier-construct-wins] the tag in the line <Callout>a ` b</Callout> <tag/> ` c is seen', async () => {
    const body = `<Callout>a \` b</Callout> ${tag('live')} \` c\n`;
    expect(await seen(body, 'live')).toEqual(['live']);
  });

  it('[ac:m51-jsx-in-caption-not-region] a tag with <Callout> in its caption value is seen', async () => {
    const body = `Intro.\n\n<single_element type="ac" slug="captioned" caption="wrap it in <Callout> first"/>\n\nMore text.\n`;
    expect(await seen(body, 'captioned')).toEqual(['captioned']);
  });

  it('[ac:m51-jsx-paired-in-inline-code-not-region] a registered tag after `<Callout>…</Callout>` quoted in inline code on the same line is seen', async () => {
    const body = `Write \`<Callout>text</Callout>\` and ${tag('live')} stays live.\n`;
    expect(await seen(body, 'live')).toEqual(['live']);
  });

  it('[ac:m51-jsx-quoted-closer-inside-block] a tag in a <Callout> block standing after a closer quoted in inline code (`</Callout>`) is not returned', async () => {
    const body = `<Callout>\nClose it with \`</Callout>\`.\n${tag('inside')}\n</Callout>\n\n${tag('live')} after.\n`;
    expect(await seen(body, 'inside', 'live')).toEqual(['live']);
  });

  it('[ac:m51-jsx-self-closing-in-inline-code-not-region] a registered tag after `<XmlChipDispatcher />` quoted in inline code on the same line is seen', async () => {
    const body = `The \`<XmlChipDispatcher />\` component renders ${tag('live')} as a chip.\n`;
    expect(await seen(body, 'live')).toEqual(['live']);
  });

  it('[ac:m51-jsx-split-pair-no-region] a registered tag between "a <Callout>b" and "c</Callout> d", separated by blank lines, is seen', async () => {
    const body = `a <Callout>b\n\n${tag('live')}\n\nc</Callout> d\n`;
    expect(await seen(body, 'live')).toEqual(['live']);
  });

  it('[ac:m51-jsx-unpaired-block-opener-read-live] a tag below an unpaired <Callout> standing alone on its line is seen', async () => {
    const body = `<Callout>\n\n${tag('below')}\n\n## Heading\n\n${tag('further')}\n`;
    expect(await seen(body, 'below', 'further')).toEqual(['below', 'further']);
  });

  it('[ac:m51-jsx-unpaired-opener-no-region] a registered tag after an unpaired <Callout> outside code is seen', async () => {
    const body = `Text <Callout> without a close, then ${tag('live')} in the same paragraph.\n\n${tag('next')}\n`;
    expect(await seen(body, 'live', 'next')).toEqual(['live', 'next']);
  });
});
