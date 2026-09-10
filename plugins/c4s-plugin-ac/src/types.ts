/**
 * The `ac` transport and record shapes, owned by the envelope that contributes
 * the type.
 *
 * 0.2.80 — moved out of the host's `shared/entities.ts`. Nothing in the host
 * referenced them once the vertical left; what stayed behind is `AcVerifyRef` /
 * `AcBrokenVerify`, which are M19's vocabulary for consistency rules 9-11, not
 * this type's.
 *
 * `verifies[]` is re-declared here rather than imported back, because the
 * envelope owning the declaration is the point of the move: the pair `(type,
 * slug)` is what `data.schema` says, and this file must fail to compile if that
 * ever stops being true.
 */

export type AcKind = 'requirement' | 'edge-case';
export type AcStatus = 'active' | 'deprecated';

export interface AcVerifyRef {
  type: string;
  slug: string;
}

/**
 * Why a `verifies[]` entry does not resolve. Reported by `check_consistency`
 * (rule 9, host-side) and derived independently by the detail panel from the
 * candidate lists it already loads.
 */
export interface AcBrokenVerify extends AcVerifyRef {
  reason: 'missing' | 'inactive' | 'unknown';
}

export interface Ac {
  slug: string;
  /**
   * 0.2.51 — the criterion itself, not a label for it.
   *
   * `text` (the criterion) and `description` (optional prose beside it) were
   * collapsed into this one field, bounded at 500 characters. Nothing else on
   * the type carries prose any more.
   */
  title: string;
  kind: AcKind;
  status: AcStatus;
  verifies: AcVerifyRef[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
  /**
   * 0.2.23 — no `brokenVerifies` here.
   *
   * It was filled by the `ac` detail view, and a type contributes no read code
   * now: the record is its `data.schema` and nothing else. The AC panel derives
   * the marker from the candidate lists it already loads, and `classifyVerifies`
   * remains the server-side answer for `check_consistency`, which is a
   * project-wide report rather than a field on one record.
   */
}

export interface AcCreateInput {
  /** The criterion. Required — the type derives no default for it. */
  title: string;
  kind?: AcKind;
  status?: AcStatus;
  verifies?: AcVerifyRef[];
  tags?: string[];
  /** Optional explicit slug — used by M17 restore to preserve identity. */
  slug?: string;
}

export interface AcUpdateInput {
  title?: string;
  kind?: AcKind;
  status?: AcStatus;
  verifies?: AcVerifyRef[];
  tags?: string[];
  /** A rename. Editing `title` does NOT re-derive the slug. */
  newSlug?: string;
}

export interface AcListQuery {
  status?: AcStatus | 'all';
  kind?: AcKind;
  tags?: string[];
  tagFilter?: 'and' | 'or';
  search?: string;
  limit?: number;
  offset?: number;
}

/**
 * A page mention left dangling by a delete. Re-declared structurally, as
 * `c4s-plugin-api-contracts` already does with the same shape — it is the
 * host's reference-layer vocabulary rather than this type's, and an envelope
 * mirrors the shape instead of importing a host module.
 */
export interface BrokenReference {
  pagePath: string;
  tagType: string;
  line: number;
  slug?: string;
  type?: string;
}

export interface AcDeleteResult {
  deleted: true;
  brokenReferences: BrokenReference[];
}
