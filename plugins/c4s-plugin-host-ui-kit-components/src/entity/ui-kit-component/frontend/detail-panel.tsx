/**
 * The detail of one `ui-kit-component` record — the `detailPanel` slot and the
 * `/ui-kit-components/$slug` route (c4s-plugin-host-ui-kit-components
 * `ctpko3bp`, `pv2psgi6`).
 *
 * Composed from catalog components (`DetailPanelShell`, `FieldGrid`,
 * `FieldRow`, `Badge`, `TagChip`, `LoadingState`, `EmptyState`) plus the three
 * host-local components the page declares LOCAL (`pv2psgi6`): `PropsTable`,
 * `TypesTable` and `DataSourcesTable`. Each is used in this one place and is
 * not universal across entity types — its columns are the fields of one
 * collection's element of this type (`props[]`, `types[]`, `dataSources[]`).
 *
 * Read-only: records are written through the generic CRUD doors.
 * `anatomy` is content-bearing and not part of the record a read returns.
 */

import type { FC, ReactNode } from 'react';
import { editorBridge } from '@c4s/plugin-runtime';
import type { EntityDetailProps } from '@c4s/plugin-runtime';
import { Badge, TagChip, DetailPanelShell, EmptyState, FieldGrid, FieldRow, LoadingState } from '@c4s/plugin-runtime/ui';
import { UI_KIT_COMPONENT_LABEL_PLURAL, UI_KIT_COMPONENT_TYPE } from '../../../identity.js';
import type { UiKitComponent, UiKitDataSource, UiKitProp, UiKitType } from '../../../types.js';
import { useGetBySlug } from './hooks.js';

const cell = { padding: '4px 8px', borderBottom: '1px solid var(--c-hair)', textAlign: 'left' as const, verticalAlign: 'top' as const };
const head = { ...cell, color: 'var(--c-muted)', fontWeight: 500 };

const Table: FC<{ testId: string; columns: string[]; children: ReactNode }> = ({ testId, columns, children }) => (
  <table data-testid={testId} className="text-[12.5px] w-full" style={{ borderCollapse: 'collapse', color: 'var(--c-ink)' }}>
    <thead>
      <tr>
        {columns.map((c) => (
          <th key={c} style={head}>
            {c}
          </th>
        ))}
      </tr>
    </thead>
    <tbody>{children}</tbody>
  </table>
);

/** LOCAL (`pv2psgi6`) — the columns of a `props[]` element. */
export const PropsTable: FC<{ props: UiKitProp[] }> = ({ props }) => (
  <Table testId="ui-kit-props-table" columns={['Name', 'Type', 'Required', 'Default', 'Description']}>
    {props.map((p) => (
      <tr key={p.name}>
        <td style={cell} className="font-mono">{p.name}</td>
        <td style={cell} className="font-mono">{p.type}</td>
        <td style={cell}>{p.required ? 'yes' : 'no'}</td>
        <td style={cell} className="font-mono">{p.default ?? ''}</td>
        <td style={cell}>{p.description ?? ''}</td>
      </tr>
    ))}
  </Table>
);

/** LOCAL (`pv2psgi6`) — the columns of a `types[]` element. */
export const TypesTable: FC<{ types: UiKitType[] }> = ({ types }) => (
  <Table testId="ui-kit-types-table" columns={['Name', 'Definition']}>
    {types.map((t) => (
      <tr key={t.name}>
        <td style={cell} className="font-mono">{t.name}</td>
        <td style={cell} className="font-mono">{t.definition}</td>
      </tr>
    ))}
  </Table>
);

/** LOCAL (`pv2psgi6`) — the columns of a `dataSources[]` element. */
export const DataSourcesTable: FC<{ dataSources: UiKitDataSource[] }> = ({ dataSources }) => (
  <Table testId="ui-kit-data-sources-table" columns={['Export', 'Usage']}>
    {dataSources.map((d, i) => (
      <tr key={`${d.export}-${i}`}>
        <td style={cell} className="font-mono">{d.export}</td>
        <td style={cell}>{d.usage}</td>
      </tr>
    ))}
  </Table>
);

/** The record view, separated from the fetch so it renders from a plain record. */
export const UiKitComponentView: FC<{ entity: UiKitComponent; onBack: () => void }> = ({ entity, onBack }) => (
  <DetailPanelShell breadcrumb={[{ label: UI_KIT_COMPONENT_LABEL_PLURAL, onClick: onBack }, { label: entity.name }]}>
    <FieldGrid>
      <FieldRow label="Name">
        <span className="font-mono">{entity.name}</span>
      </FieldRow>
      <FieldRow label="Group">
        <Badge small label={entity.group} />
      </FieldRow>
      <FieldRow label="Stability">
        <Badge small label={entity.stability} />
      </FieldRow>
      <FieldRow label="Binding">
        <Badge small label={entity.binding} />
      </FieldRow>
      {entity.soleAnatomyOf ? (
        <FieldRow label="Sole anatomy of">
          <span className="font-mono">{entity.soleAnatomyOf}</span>
        </FieldRow>
      ) : null}
      <FieldRow label="Props" align="start">
        <PropsTable props={entity.props ?? []} />
      </FieldRow>
      {(entity.types?.length ?? 0) > 0 && (
        <FieldRow label="Types" align="start">
          <TypesTable types={entity.types} />
        </FieldRow>
      )}
      {(entity.dataSources?.length ?? 0) > 0 && (
        <FieldRow label="Data sources" align="start">
          <DataSourcesTable dataSources={entity.dataSources} />
        </FieldRow>
      )}
      {(entity.composes?.length ?? 0) > 0 && (
        <FieldRow label="Composes">
          <span className="inline-flex flex-wrap gap-1">
            {entity.composes.map((c) => (
              // 2.1.39: `Badge` is a value marker with no click — the link is a button around it.
              <button
                key={c.component}
                type="button"
                className="inline-flex"
                onClick={() => editorBridge.openEntity(UI_KIT_COMPONENT_TYPE, c.component)}
              >
                <Badge small mono label={c.component} />
              </button>
            ))}
          </span>
        </FieldRow>
      )}
      {entity.behavior ? (
        <FieldRow label="Behavior" align="start">
          <div className="text-[13px]" style={{ whiteSpace: 'pre-wrap', color: 'var(--c-ink)' }}>
            {entity.behavior}
          </div>
        </FieldRow>
      ) : null}
      {(entity.tags?.length ?? 0) > 0 && (
        <FieldRow label="Tags">
          <span className="inline-flex flex-wrap gap-1">
            {entity.tags.map((t) => (
              <TagChip key={t} small label={t} />
            ))}
          </span>
        </FieldRow>
      )}
    </FieldGrid>
  </DetailPanelShell>
);

export const UiKitComponentDetail: FC<EntityDetailProps> = ({ slug, onBack }) => {
  const { data, isLoading } = useGetBySlug(slug);
  if (isLoading || data === undefined) return <LoadingState lines={6} />;
  if (data === null) return <EmptyState title="UI kit component not found." hint={slug} />;
  return <UiKitComponentView entity={data} onBack={onBack} />;
};
