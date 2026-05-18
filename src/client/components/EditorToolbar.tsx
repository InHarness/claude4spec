import { Link, useRouterState } from '@tanstack/react-router';
import { Braces, ChevronRight, Database, Monitor } from 'lucide-react';
import { MethodBadge } from './atoms.js';
import { ButtonGroup } from './ButtonGroup.js';
import { ChatToggleButton } from './ChatToggleButton.js';
import { OutlineButton } from './OutlineButton.js';
import { PageViewSwitcher } from './PageViewSwitcher.js';
import type { EntityType, HttpMethod } from '../../shared/entities.js';

export type EditorSelection =
  | { kind: 'none' }
  | { kind: 'page'; path: string }
  | { kind: 'endpoints-list' }
  | { kind: 'dtos-list' }
  | { kind: 'database-tables-list' }
  | { kind: 'ui-views-list' }
  | { kind: 'acs-list' }
  | { kind: 'tags-list' }
  | { kind: 'todos-list' }
  | { kind: 'page-links-list' }
  | { kind: 'releases-list' }
  | { kind: 'release-detail'; idOrName: string }
  | { kind: 'plans-list' }
  | { kind: 'briefs-list' }
  | { kind: 'brief-detail'; path: string }
  | {
      kind: 'entity';
      entityType: EntityType;
      slug: string;
      method?: HttpMethod;
      path?: string;
      name?: string;
    };

interface Props {
  selection: EditorSelection;
}

export function EditorToolbar({ selection }: Props) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div
      className="flex items-center gap-2 px-5 py-2.5"
      style={{ borderBottom: '1px solid var(--c-hair)', background: 'var(--c-bg)' }}
    >
      <div
        className="flex items-center gap-1.5 text-[12px] min-w-0"
        style={{ color: 'var(--c-muted)' }}
      >
        {renderBreadcrumb(selection, pathname)}
      </div>
      <span className="flex-1" />
      {selection.kind === 'page' && <PageViewSwitcher />}
      <ButtonGroup>
        <OutlineButton onPage={selection.kind === 'page'} />
        <ChatToggleButton />
      </ButtonGroup>
    </div>
  );
}

function renderBreadcrumb(selection: EditorSelection, pathname: string): React.ReactNode {
  if (selection.kind === 'none') {
    return <span style={{ color: 'var(--c-subtle)' }}>Nothing selected</span>;
  }
  if (selection.kind === 'endpoints-list') {
    return <span style={{ color: 'var(--c-ink)', fontWeight: 600 }}>Endpoints</span>;
  }
  if (selection.kind === 'dtos-list') {
    return <span style={{ color: 'var(--c-ink)', fontWeight: 600 }}>DTOs</span>;
  }
  if (selection.kind === 'database-tables-list') {
    return (
      <span style={{ color: 'var(--c-ink)', fontWeight: 600 }}>Database Tables</span>
    );
  }
  if (selection.kind === 'ui-views-list') {
    return <span style={{ color: 'var(--c-ink)', fontWeight: 600 }}>UI Views</span>;
  }
  if (selection.kind === 'acs-list') {
    return <span style={{ color: 'var(--c-ink)', fontWeight: 600 }}>Acceptance Criteria</span>;
  }
  if (selection.kind === 'tags-list') {
    return <span style={{ color: 'var(--c-ink)', fontWeight: 600 }}>Tags</span>;
  }
  if (selection.kind === 'todos-list') {
    return <span style={{ color: 'var(--c-ink)', fontWeight: 600 }}>TODOs</span>;
  }
  if (selection.kind === 'page-links-list') {
    return <span style={{ color: 'var(--c-ink)', fontWeight: 600 }}>Links</span>;
  }
  if (selection.kind === 'releases-list') {
    return <span style={{ color: 'var(--c-ink)', fontWeight: 600 }}>Releases</span>;
  }
  if (selection.kind === 'plans-list') {
    return <span style={{ color: 'var(--c-ink)', fontWeight: 600 }}>Plans</span>;
  }
  if (selection.kind === 'briefs-list') {
    return <span style={{ color: 'var(--c-ink)', fontWeight: 600 }}>Briefs</span>;
  }
  if (selection.kind === 'brief-detail') {
    return (
      <>
        <Link to="/briefs" className={crumbLinkClass} style={crumbLinkStyle}>
          Briefs
        </Link>
        <ChevronRight size={11} />
        <span style={{ color: 'var(--c-ink)', fontWeight: 600 }} className="font-mono">
          {selection.path}
        </span>
      </>
    );
  }
  if (selection.kind === 'release-detail') {
    return (
      <>
        <Link to="/releases" className={crumbLinkClass} style={crumbLinkStyle}>
          Releases
        </Link>
        <ChevronRight size={11} />
        <span style={{ color: 'var(--c-ink)', fontWeight: 600 }} className="font-mono">
          {selection.idOrName}
        </span>
      </>
    );
  }
  if (selection.kind === 'page') {
    const segments = selection.path.split('/');
    return segments.map((s, i) => (
      <span key={`${s}-${i}`} className="flex items-center gap-1.5">
        <span
          style={{
            color: i === segments.length - 1 ? 'var(--c-ink)' : 'var(--c-muted)',
            fontWeight: i === segments.length - 1 ? 600 : 400,
          }}
        >
          {s}
        </span>
        {i < segments.length - 1 && <ChevronRight size={11} />}
      </span>
    ));
  }
  const onHistory = pathname.endsWith('/history');
  const entityType = selection.entityType;
  const listLabel =
    entityType === 'dto'
      ? 'DTOs'
      : entityType === 'database-table'
        ? 'Database Tables'
        : entityType === 'ui-view'
          ? 'UI Views'
          : 'Endpoints';
  const listLink =
    entityType === 'dto' ? (
      <Link to="/dtos" className={crumbLinkClass} style={crumbLinkStyle}>
        {listLabel}
      </Link>
    ) : entityType === 'database-table' ? (
      <Link to="/database-tables" className={crumbLinkClass} style={crumbLinkStyle}>
        {listLabel}
      </Link>
    ) : entityType === 'ui-view' ? (
      <Link to="/ui-views" className={crumbLinkClass} style={crumbLinkStyle}>
        {listLabel}
      </Link>
    ) : (
      <Link to="/endpoints" className={crumbLinkClass} style={crumbLinkStyle}>
        {listLabel}
      </Link>
    );
  let detailLink: React.ReactNode;
  if (onHistory) {
    if (entityType === 'dto') {
      detailLink = (
        <Link
          to="/dtos/$slug"
          params={{ slug: selection.slug }}
          className={crumbLinkClass}
          style={crumbLinkStyle}
        >
          <EntityCrumbBody selection={selection} />
        </Link>
      );
    } else if (entityType === 'database-table') {
      detailLink = (
        <Link
          to="/database-tables/$slug"
          params={{ slug: selection.slug }}
          className={crumbLinkClass}
          style={crumbLinkStyle}
        >
          <EntityCrumbBody selection={selection} />
        </Link>
      );
    } else if (entityType === 'ui-view') {
      detailLink = (
        <Link
          to="/ui-views/$slug"
          params={{ slug: selection.slug }}
          className={crumbLinkClass}
          style={crumbLinkStyle}
        >
          <EntityCrumbBody selection={selection} />
        </Link>
      );
    } else {
      detailLink = (
        <Link
          to="/endpoints/$slug"
          params={{ slug: selection.slug }}
          className={crumbLinkClass}
          style={crumbLinkStyle}
        >
          <EntityCrumbBody selection={selection} />
        </Link>
      );
    }
  } else {
    detailLink = (
      <span
        className="flex items-center gap-1.5"
        style={{ color: 'var(--c-ink)', fontWeight: 600 }}
      >
        <EntityCrumbBody selection={selection} />
      </span>
    );
  }
  return (
    <>
      {listLink}
      <ChevronRight size={11} />
      {detailLink}
      {onHistory && (
        <>
          <ChevronRight size={11} />
          <span style={{ color: 'var(--c-ink)', fontWeight: 600 }}>History</span>
        </>
      )}
    </>
  );
}

const crumbLinkClass = 'inline-flex items-center gap-1.5 rounded px-1 -mx-1 transition';
const crumbLinkStyle: React.CSSProperties = { color: 'var(--c-muted)' };

function EntityCrumbBody({
  selection,
}: {
  selection: Extract<EditorSelection, { kind: 'entity' }>;
}) {
  if (selection.entityType === 'endpoint') {
    return (
      <>
        {selection.method && <MethodBadge method={selection.method} />}
        {selection.path && <span className="font-mono">{selection.path}</span>}
      </>
    );
  }
  if (selection.entityType === 'dto') {
    return (
      <>
        <Braces size={12} style={{ color: 'var(--c-accent)' }} />
        <span>{selection.name ?? selection.slug}</span>
      </>
    );
  }
  if (selection.entityType === 'database-table') {
    return (
      <>
        <Database size={12} style={{ color: 'var(--c-accent)' }} />
        <span className="font-mono">{selection.name ?? selection.slug}</span>
      </>
    );
  }
  if (selection.entityType === 'ui-view') {
    return (
      <>
        <Monitor size={12} style={{ color: 'var(--c-accent)' }} />
        <span>{selection.name ?? selection.slug}</span>
      </>
    );
  }
  return <span className="font-mono">{selection.slug}</span>;
}

