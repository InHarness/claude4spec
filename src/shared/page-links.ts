export interface FileMeta {
  path: string;
  title: string;
  anchors: string[];
}

export type PageLinkSyntax = 'at' | 'backticks' | 'link';

export interface PageLink {
  syntax: PageLinkSyntax;
  rawToken: string;
  targetPath: string;
  anchor?: string;
  line: number;
  col: number;
}

export interface UnresolvedMention {
  syntax: 'at' | 'link';
  rawToken: string;
  candidatePath: string;
  line: number;
  col: number;
}

export interface PageLinkAutocompleteItem {
  path: string;
  title: string;
  matchScore: number;
}

export interface PageLinksCounts {
  brokenLinkCount: number;
  unresolvedMentionCount: number;
  totalLinks: number;
}

export interface PageLinksListResponse {
  links: Record<string, PageLink[]>;
  reverseLinks: Record<string, string[]>;
  unresolved: Record<string, UnresolvedMention[]>;
  counts: PageLinksCounts;
}

export interface PageLinksAutocompleteResponse {
  suggestions: PageLinkAutocompleteItem[];
}
