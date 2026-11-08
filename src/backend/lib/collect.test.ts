import {describe, expect, it} from 'vitest';

import {collectLinks, contentKeyOf, contentTypesIn, linksInHtml, type TypeInfo, type VersionContent} from './collect';

const TYPES: Record<string, TypeInfo> = {
  DynamicExperience: {displayName: 'Experience', baseType: '_experience', properties: {metaTitle: {displayName: 'Meta title', type: 'string'}}},
  ProductCardBlock: {
    displayName: 'Product Card',
    baseType: '_component',
    properties: {
      title: {displayName: 'Title', type: 'string'},
      linkUrl: {displayName: 'Link URL', type: 'url'},
      image: {displayName: 'Image', type: 'contentReference'},
    },
  },
  RichTextBlock: {displayName: 'Rich Text', baseType: '_component', properties: {body: {displayName: 'Body', type: 'richText'}}},
  RawHtmlBlock: {displayName: 'Raw HTML', baseType: '_component', properties: {html: {displayName: 'HTML', type: 'string'}}},
  FaqContainerBlock: {displayName: 'FAQ Container', baseType: '_component', properties: {faqItems: {displayName: 'FAQ items', type: 'array'}}},
  RedirectRule: {displayName: 'Redirect Rule', baseType: '_component', properties: {fromPath: {displayName: 'From path', type: 'string'}}},
};
const types = (key: string | undefined) => (key ? TYPES[key] : undefined);

const KEY_A = '4fb677b1b09c4916bcf7a2a66bd2baae';
const KEY_B = 'fb900000000000000000000000000001';

// The shape GET /v1/content/{key}/versions/{version} returns for an experience.
const VERSION: VersionContent = {
  contentType: 'DynamicExperience',
  properties: {metaTitle: {value: 'Mosey Bank'}},
  composition: {
    nodeType: 'experience',
    displayName: 'Homepage',
    nodes: [
      {
        nodeType: 'section',
        displayName: 'Products',
        nodes: [
          {
            nodeType: 'row',
            nodes: [
              {
                nodeType: 'column',
                nodes: [
                  {
                    nodeType: 'component',
                    displayName: 'Savings card',
                    component: {
                      contentType: 'ProductCardBlock',
                      properties: {
                        title: {value: 'Savings'},
                        linkUrl: {value: `cms://content/${KEY_A}`},
                        image: {value: `cms://content/${KEY_B}`},
                      },
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        nodeType: 'component',
        displayName: 'Intro',
        component: {
          contentType: 'RichTextBlock',
          properties: {body: {value: {html: '<p>See <a href="/personal/savings">our <b>savings</b></a> or <a href="mailto:x@y.z">mail</a>.</p>'}}},
        },
      },
      {
        nodeType: 'component',
        displayName: 'Banner',
        component: {contentType: 'RawHtmlBlock', properties: {html: {value: '<a href="/premium">Go premium</a><img src="https://cdn.example.com/a.png">'}}},
      },
      {nodeType: 'component', displayName: 'FAQs', component: {contentType: 'FaqContainerBlock', properties: {faqItems: {value: [{reference: `cms://content/${KEY_B}`}]}}}},
      {nodeType: 'component', displayName: 'Testimonial', component: {reference: `cms://content/${KEY_A}`}},
    ],
  },
};

describe('collectLinks', () => {
  const links = collectLinks(VERSION, types);

  it('finds url fields, references, rich text and raw HTML, in page order', () => {
    expect(links).toEqual([
      {target: `cms://content/${KEY_A}`, kind: 'link', where: 'Products > Savings card > Link URL'},
      {target: `cms://content/${KEY_B}`, kind: 'reference', where: 'Products > Savings card > Image'},
      {target: '/personal/savings', kind: 'link', where: 'Intro > Body', text: 'our savings'},
      {target: '/premium', kind: 'link', where: 'Banner > HTML', text: 'Go premium'},
      {target: 'https://cdn.example.com/a.png', kind: 'link', where: 'Banner > HTML', text: 'image'},
      {target: `cms://content/${KEY_B}`, kind: 'reference', where: 'FAQs > FAQ items'},
      {target: `cms://content/${KEY_A}`, kind: 'reference', where: 'Testimonial'},
    ]);
  });

  it('skips mailto, tel and anchors, and plain strings that only look like paths', () => {
    expect(links.some((l) => l.target.startsWith('mailto:'))).toBe(false);
    const rule = collectLinks({contentType: 'RedirectRule', properties: {fromPath: {value: '/savings-accounts'}}}, types);
    expect(rule).toEqual([]);
  });

  it('reads inline blocks in content areas and Slate-style rich text JSON', () => {
    const found = collectLinks(
      {
        contentType: 'FaqContainerBlock',
        properties: {
          faqItems: {value: [{contentType: 'ProductCardBlock', properties: {linkUrl: {value: 'https://example.com/x'}}}]},
          extra: {value: {json: {type: 'richText', children: [{type: 'link', url: '/help', children: [{text: 'Help'}]}]}}},
        },
      },
      types,
    );
    expect(found).toEqual([
      {target: 'https://example.com/x', kind: 'link', where: 'FAQ items > Product Card > Link URL'},
      {target: '/help', kind: 'link', where: 'extra', text: 'Help'},
    ]);
  });

  it('labels a shared block when given a prefix', () => {
    const found = collectLinks({contentType: 'ProductCardBlock', properties: {linkUrl: {value: '/a'}}}, types, 'Card (shared block)');
    expect(found).toEqual([{target: '/a', kind: 'link', where: 'Card (shared block) > Link URL'}]);
  });
});

describe('helpers', () => {
  it('reads content keys only from cms://content/{32 hex}', () => {
    expect(contentKeyOf(`cms://content/${KEY_A.toUpperCase()}`)).toBe(KEY_A);
    expect(contentKeyOf('cms://content/DamImageSourceRendition/123')).toBeNull();
    expect(contentKeyOf('/x')).toBeNull();
  });

  it('decodes entities in HTML links', () => {
    expect(linksInHtml('<a class="x" href="/a?b=1&amp;c=2">A &amp; B</a>')).toEqual([{target: '/a?b=1&c=2', text: 'A & B'}]);
  });

  it('lists every content type in a version', () => {
    expect([...contentTypesIn(VERSION)].sort()).toEqual(['DynamicExperience', 'FaqContainerBlock', 'ProductCardBlock', 'RawHtmlBlock', 'RichTextBlock']);
  });
});
