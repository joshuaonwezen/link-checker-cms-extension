import type {FoundLink, LinkKind} from '../../shared/types';

// Finds every link and content reference in one CMS REST version - its properties and its
// Visual Builder composition - without any per-type code. A content type definition is only
// used for labels and to know which strings are url fields.

/** A property as the CMS REST API returns it: {value}. */
export type PropertyData = {value?: unknown} | null | undefined;
export type Properties = Record<string, PropertyData>;

export interface CompositionNode {
  id?: string;
  displayName?: string;
  nodeType?: string;
  component?: {contentType?: string; reference?: string; properties?: Properties} | null;
  nodes?: CompositionNode[] | null;
}

export interface VersionContent {
  contentType?: string;
  displayName?: string;
  properties?: Properties | null;
  composition?: CompositionNode | null;
}

export interface TypeInfo {
  displayName?: string;
  baseType?: string;
  properties?: Record<string, {displayName?: string; type?: string} | undefined>;
}

export type TypeLookup = (contentType: string | undefined) => TypeInfo | undefined;

const CONTENT_REF = /^cms:\/\/content\/([0-9a-f]{32})(?:[?#].*)?$/i;
const ANCHOR = /<a\b[^>]*?\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a\s*>/gi;
const IMAGE = /<img\b[^>]*?\bsrc\s*=\s*(["'])(.*?)\1/gi;
const LINKISH_NAME = /(url|link|href)$/i;
const MAX_TEXT = 80;

/** The content key of a cms://content/{key} reference, or null. */
export function contentKeyOf(target: string): string | null {
  return CONTENT_REF.exec(target.trim())?.[1]?.toLowerCase() ?? null;
}

/** Targets nobody can follow or check: anchors, mail, phone, script and empty values. */
export function isCheckable(target: string): boolean {
  const t = target.trim();
  if (!t || t.startsWith('#') || t.includes('{{')) return false;
  return !/^(mailto|tel|sms|javascript|data):/i.test(t);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function linkText(html: string): string | undefined {
  const text = decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;
}

/** The <a href> and <img src> targets in an HTML string. */
export function linksInHtml(html: string): Array<{target: string; text?: string}> {
  const found: Array<{target: string; text?: string}> = [];
  for (const m of html.matchAll(ANCHOR)) found.push({target: decodeEntities(m[2]), text: linkText(m[3])});
  for (const m of html.matchAll(IMAGE)) found.push({target: decodeEntities(m[2]), text: 'image'});
  return found;
}

const looksLikeHtml = (s: string) => /<a\b|<img\b/i.test(s);
const looksLikeUrl = (s: string) => /^(https?:\/\/|\/)/i.test(s.trim());

class Collector {
  public readonly links: FoundLink[] = [];
  private readonly seen = new Set<string>();

  public constructor(private readonly types: TypeLookup) {}

  public add(target: string, kind: LinkKind, where: string, text?: string) {
    if (!isCheckable(target)) return;
    const id = `${kind}|${target}|${where}|${text ?? ''}`;
    if (this.seen.has(id)) return;
    this.seen.add(id);
    this.links.push(text ? {target: target.trim(), kind, where, text} : {target: target.trim(), kind, where});
  }

  public properties(contentType: string | undefined, properties: Properties | null | undefined, where: string) {
    const info = this.types(contentType);
    for (const [name, data] of Object.entries(properties ?? {})) {
      const prop = info?.properties?.[name];
      const label = prop?.displayName || name;
      this.value(data?.value, join(where, label), prop?.type ?? (info ? undefined : 'unknown'), name);
    }
  }

  private value(value: unknown, where: string, propType: string | undefined, name: string) {
    if (value === null || value === undefined) return;
    if (typeof value === 'string') return this.string(value, where, propType, name);
    if (Array.isArray(value)) {
      value.forEach((item) => this.value(item, where, propType, name));
      return;
    }
    if (typeof value !== 'object') return;

    const obj = value as Record<string, unknown>;
    // A block in a content area, or a single type:"content" reference.
    if (typeof obj.reference === 'string') return this.add(obj.reference, 'reference', where);
    // An inline block: in a content area, or a type:"component" property.
    if (obj.properties && typeof obj.properties === 'object') {
      const type = typeof obj.contentType === 'string' ? obj.contentType : undefined;
      const label = type ? this.types(type)?.displayName || type : undefined;
      return this.properties(type, obj.properties as Properties, label ? join(where, label) : where);
    }
    // Rich text: {html} and/or the editor's JSON tree.
    if (typeof obj.html === 'string') this.html(obj.html, where);
    if (obj.json && typeof obj.json === 'object') this.richTextJson(obj.json, where);
    if (typeof obj.html === 'string' || obj.json) return;
    for (const [key, inner] of Object.entries(obj)) this.value(inner, where, undefined, key);
  }

  private string(value: string, where: string, propType: string | undefined, name: string) {
    if (contentKeyOf(value)) {
      // A url field links to the content; a contentReference field renders it.
      return this.add(value, propType === 'url' ? 'link' : 'reference', where);
    }
    if (looksLikeHtml(value)) return this.html(value, where);
    const linkish = propType === 'url' || ((propType === undefined || propType === 'unknown') && LINKISH_NAME.test(name));
    if (linkish && looksLikeUrl(value)) this.add(value, 'link', where);
  }

  private html(html: string, where: string) {
    for (const {target, text} of linksInHtml(html)) this.add(target, 'link', where, text);
  }

  // Slate-style nodes: {type: "link", url, children}.
  private richTextJson(node: unknown, where: string) {
    if (Array.isArray(node)) return node.forEach((n) => this.richTextJson(n, where));
    if (!node || typeof node !== 'object') return;
    const n = node as {type?: unknown; url?: unknown; href?: unknown; children?: unknown};
    const url = typeof n.url === 'string' ? n.url : typeof n.href === 'string' ? n.href : null;
    if (url && (n.type === 'link' || n.type === 'a')) this.add(url, 'link', where, linkText(textOf(n.children)));
    if (n.children) this.richTextJson(n.children, where);
  }

  public composition(node: CompositionNode | null | undefined, where: string) {
    if (!node) return;
    const label = node.displayName || node.nodeType || '';
    const here = node.nodeType === 'experience' ? where : join(where, label);
    const component = node.component;
    if (component?.reference) this.add(component.reference, 'reference', here);
    else if (component) this.properties(component.contentType, component.properties, here);
    for (const child of node.nodes ?? []) {
      // Sections, rows and columns are layout: their own names add nothing to the breadcrumb.
      this.composition(child, node.nodeType === 'experience' ? where : layoutWhere(node, here, where));
    }
  }
}

function layoutWhere(node: CompositionNode, here: string, parent: string): string {
  return node.nodeType === 'row' || node.nodeType === 'column' ? parent : here;
}

function textOf(children: unknown): string {
  if (!Array.isArray(children)) return '';
  return children
    .map((c) => (c && typeof c === 'object' ? ((c as {text?: unknown}).text as string | undefined) ?? textOf((c as {children?: unknown}).children) : ''))
    .join('');
}

function join(where: string, label: string): string {
  if (!where) return label;
  // A section and the one block in it are often named alike: "Products Heading > Products Heading".
  return where.split(' > ').pop() === label ? where : `${where} > ${label}`;
}

/** Every link and reference in one version, in page order, without duplicates. */
export function collectLinks(version: VersionContent, types: TypeLookup, where = ''): FoundLink[] {
  const collector = new Collector(types);
  collector.properties(version.contentType, version.properties, where);
  collector.composition(version.composition, where);
  return collector.links;
}

/** Every content type named anywhere in the version, so their definitions can be fetched first. */
export function contentTypesIn(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => contentTypesIn(v, found));
  else if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      if (key === 'contentType' && typeof inner === 'string') found.add(inner);
      else contentTypesIn(inner, found);
    }
  }
  return found;
}
