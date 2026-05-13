import { useState } from 'react';
import { HelpCircle, Send, X, AlertTriangle } from 'lucide-react';
import type { UserInputRequest, UserInputResponse } from '@inharness-ai/agent-adapters';

interface Props {
  request: UserInputRequest;
  onSubmit: (requestId: string, response: UserInputResponse) => void | Promise<void>;
}

export function UserInputRequestCard({ request, onSubmit }: Props) {
  const [answers, setAnswers] = useState<string[][]>(() => request.questions.map(() => []));
  const [customValues, setCustomValues] = useState<string[]>(() => request.questions.map(() => ''));
  const [submitting, setSubmitting] = useState<false | UserInputResponse['action']>(false);

  const updateAnswer = (qIdx: number, values: string[]) => {
    setAnswers((prev) => prev.map((v, i) => (i === qIdx ? values : v)));
  };

  const updateCustom = (qIdx: number, value: string) => {
    setCustomValues((prev) => prev.map((v, i) => (i === qIdx ? value : v)));
  };

  const handleAccept = async () => {
    const finalAnswers = request.questions.map((q, i) => {
      const selected = answers[i] ?? [];
      const custom = customValues[i]?.trim() ?? '';
      if (q.options) {
        return custom ? [...selected, custom] : selected;
      }
      return custom ? [custom] : [];
    });
    setSubmitting('accept');
    await onSubmit(request.requestId, { action: 'accept', answers: finalAnswers });
  };

  const handleAction = async (action: 'decline' | 'cancel') => {
    setSubmitting(action);
    await onSubmit(request.requestId, { action });
  };

  const canAccept = request.questions.every((q, i) => {
    const selected = answers[i] ?? [];
    const custom = customValues[i]?.trim() ?? '';
    if (q.options) return selected.length > 0 || custom.length > 0;
    return custom.length > 0;
  });

  const sourceLabel = request.source === 'model-tool' ? 'agent question' : 'mcp elicitation';

  return (
    <div
      className="mx-3 mb-2 rounded-lg overflow-hidden"
      style={{
        background: 'var(--c-card)',
        border: '1px solid var(--c-accent)',
        boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
      }}
    >
      <div
        className="px-3 py-2 flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider"
        style={{
          background: 'var(--c-accent-soft)',
          color: 'var(--c-accent)',
          borderBottom: '1px solid var(--c-hair)',
        }}
      >
        <HelpCircle size={12} />
        <span>{sourceLabel}</span>
        <span style={{ color: 'var(--c-muted)' }}>·</span>
        <span style={{ color: 'var(--c-muted)' }} className="normal-case">
          {request.origin}
        </span>
      </div>

      <div className="px-3 py-3 space-y-4">
        {request.questions.map((q, qIdx) => (
          <QuestionForm
            key={qIdx}
            question={q}
            selected={answers[qIdx] ?? []}
            custom={customValues[qIdx] ?? ''}
            onSelect={(values) => updateAnswer(qIdx, values)}
            onCustomChange={(value) => updateCustom(qIdx, value)}
          />
        ))}
      </div>

      <div
        className="px-3 py-2 flex items-center gap-1.5"
        style={{ background: 'var(--c-panel)', borderTop: '1px solid var(--c-hair)' }}
      >
        <button
          onClick={() => handleAction('decline')}
          disabled={Boolean(submitting)}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px]"
          style={{
            background: 'transparent',
            color: 'var(--c-muted)',
            border: '1px solid var(--c-hair-strong)',
          }}
          title="Decline — tell the agent you don't want to answer"
        >
          <AlertTriangle size={11} /> Decline
        </button>
        <button
          onClick={() => handleAction('cancel')}
          disabled={Boolean(submitting)}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px]"
          style={{ background: 'transparent', color: 'var(--c-muted)' }}
          title="Cancel — dismiss without answering"
        >
          <X size={11} /> Cancel
        </button>
        <span className="flex-1" />
        <button
          onClick={handleAccept}
          disabled={!canAccept || Boolean(submitting)}
          className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11.5px] disabled:opacity-40"
          style={{ background: 'var(--c-accent)', color: '#fff' }}
        >
          <Send size={11} /> Send answer
        </button>
      </div>
    </div>
  );
}

interface QuestionFormProps {
  question: UserInputRequest['questions'][number];
  selected: string[];
  custom: string;
  onSelect: (values: string[]) => void;
  onCustomChange: (value: string) => void;
}

function QuestionForm({ question, selected, custom, onSelect, onCustomChange }: QuestionFormProps) {
  const isMulti = Boolean(question.multiSelect);

  const toggleOption = (label: string) => {
    if (isMulti) {
      onSelect(selected.includes(label) ? selected.filter((v) => v !== label) : [...selected, label]);
    } else {
      onSelect(selected[0] === label ? [] : [label]);
    }
  };

  return (
    <div>
      {question.header && (
        <div
          className="text-[10.5px] font-mono uppercase tracking-wider mb-1"
          style={{ color: 'var(--c-subtle)' }}
        >
          {question.header}
        </div>
      )}
      <div className="text-[13px] mb-2" style={{ color: 'var(--c-ink)' }}>
        {question.question}
      </div>

      {question.options && question.options.length > 0 && (
        <div className="space-y-1 mb-2">
          {question.options.map((opt) => {
            const active = selected.includes(opt.label);
            return (
              <button
                key={opt.label}
                onClick={() => toggleOption(opt.label)}
                className="w-full text-left flex items-start gap-2 px-2 py-1.5 rounded-md"
                style={{
                  background: active ? 'var(--c-accent-soft)' : 'var(--c-panel)',
                  border: `1px solid ${active ? 'var(--c-accent)' : 'var(--c-hair)'}`,
                }}
              >
                <span
                  className="mt-1 rounded-full flex-shrink-0"
                  style={{
                    width: 9,
                    height: 9,
                    background: active ? 'var(--c-accent)' : 'var(--c-card)',
                    border: `1.5px solid ${active ? 'var(--c-accent)' : 'var(--c-hair-strong)'}`,
                    borderRadius: isMulti ? 2 : 999,
                  }}
                />
                <span className="flex-1 min-w-0">
                  <div className="text-[12.5px]" style={{ color: 'var(--c-ink)' }}>
                    {opt.label}
                  </div>
                  {opt.description && (
                    <div className="text-[11px]" style={{ color: 'var(--c-subtle)' }}>
                      {opt.description}
                    </div>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <textarea
        value={custom}
        onChange={(e) => onCustomChange(e.target.value)}
        placeholder={
          question.placeholder ??
          (question.options ? 'Or type a custom answer…' : 'Type your answer…')
        }
        rows={question.options ? 1 : 2}
        className="w-full rounded-md px-2 py-1.5 text-[12.5px] outline-none"
        style={{
          background: 'var(--c-panel)',
          color: 'var(--c-ink)',
          border: '1px solid var(--c-hair-strong)',
          resize: 'vertical',
        }}
      />
    </div>
  );
}
