import { useState, type FormEvent } from 'react';
import { Dialog } from '../../host-ui-kit/overlay/Dialog.js';
import { FormField } from '../../host-ui-kit/form/FormField.js';
import { ActionButton } from '../../host-ui-kit/actions/ActionButton.js';
import { ApiError } from '../../lib/api-core.js';
import { fieldOfError, runnerHostsApi, type RunnerHostResponse } from '../../lib/runner-hosts.js';
import type { ModalFormProps } from '../../ui/ModalHost.js';

/** M54 `wzku2ck1`: the URL placeholder — the runner's default port (`c4s-runner` M01 #pa8wsx7a). */
export const RUNNER_HOST_URL_PLACEHOLDER = 'http://host:7420';
/** M54 `wzku2ck1`: the token helper of the create window (command name: `c4s-runner` M02 #0yq0kj3x). */
export const RUNNER_HOST_TOKEN_HELP =
  'Paste the token printed by "c4s-runner token create". It is encrypted and stored on this machine — not in config.json, not in the repo.';
/** M54 `wzku2ck1`: the token helper of the edit window, where the field starts empty. */
export const RUNNER_HOST_TOKEN_KEEP_HELP = 'Leave empty to keep the current token.';

type Field = 'url' | 'token' | 'label';
type Errors = Partial<Record<Field, string>> & { form?: string };

const INPUT_STYLE = {
  background: 'var(--c-panel)',
  border: '1px solid var(--c-hair)',
  color: 'var(--c-ink)',
} as const;

/**
 * The window's request failed: a refusal naming a field stands under that field
 * (`url: …` → URL), anything else under the form.
 */
function errorsOf(err: unknown): Errors {
  if (err instanceof ApiError) {
    const field = fieldOfError(err.code, err.message);
    if (field) return { [field]: err.message.replace(/^(url|token|label):\s*/, '') };
    return { form: err.message };
  }
  return { form: 'Request failed — is the server still running?' };
}

/**
 * M54 L5 `wzku2ck1` — the `runner-host-create` window (payload
 * `create-runner-host-request`): URL, Token (a password field), optional Label.
 */
export function RunnerHostCreateDialog({ onClose }: ModalFormProps<'runner-host-create'>) {
  return (
    <RunnerHostForm
      title="Add runner host"
      submitLabel="Add runner host"
      initial={{ url: '', label: '' }}
      tokenHelp={RUNNER_HOST_TOKEN_HELP}
      onCancel={() => onClose(null)}
      save={async ({ url, token, label }) => {
        const host = await runnerHostsApi.create({ url, token, ...(label.trim() ? { label } : {}) });
        onClose(host);
      }}
    />
  );
}

/**
 * M54 L5 `wzku2ck1` — the `runner-host-edit` window (payload
 * `update-runner-host-request`): the same fields; the token starts empty and an
 * empty token keeps the stored one (it is not sent).
 */
export function RunnerHostEditDialog({ request, onClose }: ModalFormProps<'runner-host-edit'>) {
  const { host } = request.props;
  return (
    <RunnerHostForm
      title="Edit runner host"
      submitLabel="Save"
      initial={{ url: host.url, label: host.label ?? '' }}
      tokenHelp={RUNNER_HOST_TOKEN_KEEP_HELP}
      onCancel={() => onClose(null)}
      save={async ({ url, token, label }) => {
        // Only what changed goes out: a field left out stays as it is.
        const tokenChanged = token.trim() !== '';
        const saved = await runnerHostsApi.update(host.id, {
          ...(url !== host.url ? { url } : {}),
          ...(label !== (host.label ?? '') ? { label } : {}),
          ...(tokenChanged ? { token } : {}),
        });
        onClose({ host: saved, tokenChanged });
      }}
    />
  );
}

interface FormValues {
  url: string;
  token: string;
  label: string;
}

function RunnerHostForm({
  title,
  submitLabel,
  initial,
  tokenHelp,
  onCancel,
  save,
}: {
  title: string;
  submitLabel: string;
  initial: { url: string; label: string };
  tokenHelp: string;
  onCancel: () => void;
  save: (values: FormValues) => Promise<void>;
}) {
  const [values, setValues] = useState<FormValues>({ url: initial.url, token: '', label: initial.label });
  const [errors, setErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);

  const set = (field: Field) => (value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    setErrors((e) => ({ ...e, [field]: undefined, form: undefined }));
  };

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (pending) return;
    setPending(true);
    setErrors({});
    try {
      await save(values);
    } catch (err) {
      setErrors(errorsOf(err));
      setPending(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onCancel}
      title={title}
      size="sm"
      footer={
        <>
          <ActionButton label="Cancel" variant="ghost" onClick={onCancel} />
          <ActionButton
            label={pending ? 'Saving…' : submitLabel}
            variant="primary"
            disabled={pending}
            onClick={() => void submit()}
          />
        </>
      }
    >
      <form className="flex flex-col gap-3" onSubmit={(e) => void submit(e)} data-testid="runner-host-form">
        <FormField label="URL" error={errors.url}>
          <input
            name="url"
            aria-label="URL"
            value={values.url}
            onChange={(e) => set('url')(e.target.value)}
            placeholder={RUNNER_HOST_URL_PLACEHOLDER}
            autoComplete="off"
            className="w-full rounded-md px-2.5 py-1.5 text-[12.5px] font-mono outline-none"
            style={INPUT_STYLE}
          />
        </FormField>
        <FormField label="Token" error={errors.token}>
          <input
            name="token"
            aria-label="Token"
            type="password"
            value={values.token}
            onChange={(e) => set('token')(e.target.value)}
            autoComplete="new-password"
            className="w-full rounded-md px-2.5 py-1.5 text-[12.5px] font-mono outline-none"
            style={INPUT_STYLE}
          />
          <p className="text-[11.5px] mt-1" style={{ color: 'var(--c-subtle)' }}>
            {tokenHelp}
          </p>
        </FormField>
        <FormField label="Label" error={errors.label}>
          <input
            name="label"
            aria-label="Label"
            value={values.label}
            onChange={(e) => set('label')(e.target.value)}
            placeholder="Optional"
            autoComplete="off"
            className="w-full rounded-md px-2.5 py-1.5 text-[12.5px] outline-none"
            style={INPUT_STYLE}
          />
        </FormField>
        {errors.form ? (
          <p className="text-[11.5px]" style={{ color: 'var(--c-red, #c45a3b)' }} data-testid="runner-host-form-error">
            {errors.form}
          </p>
        ) : null}
        {/* Enter submits; the visible action sits in the dialog footer. */}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
