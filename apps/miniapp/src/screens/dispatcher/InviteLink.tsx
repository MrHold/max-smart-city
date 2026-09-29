import { useState } from 'react';
import { useExecutorInvite } from '../../api/hooks';
import type { Executor } from '../../api/types';
import { ensureWebApp } from '../../bridge';

/** Ссылка-приглашение в бот: пока исполнитель её не открыл, наряды до него не дойдут. */
export function InviteLink({
  executor,
  buttons = false,
}: {
  executor: Executor;
  /** Отдельной кнопкой на своей строке (список исполнителей), а не ссылкой в тексте. */
  buttons?: boolean;
}) {
  const invite = useExecutorInvite();
  const [copied, setCopied] = useState(false);
  const cls = buttons ? 'btn btn--secondary btn--sm' : 'link-btn';

  if (!invite.data) {
    return (
      <span className="row wrap" style={{ gap: 8 }}>
        <button
          type="button"
          className={cls}
          disabled={invite.isPending}
          onClick={(e) => {
            e.preventDefault();
            invite.mutate(executor.id);
          }}
        >
          {invite.isPending ? '…' : 'Пригласить в бот'}
        </button>
        {invite.isError && (
          <span className="field__error" role="alert">
            {invite.error.message}
          </span>
        )}
      </span>
    );
  }

  const url = invite.data.url;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };
  const share = () => {
    const wa = ensureWebApp();
    const text = `${executor.nameShort}, наряды по заявкам будут приходить в этот бот: ${url}`;
    if (wa.shareMaxContent) void wa.shareMaxContent({ text });
    else void copy();
  };

  return (
    <span className="row wrap" style={{ gap: 8 }}>
      <button
        type="button"
        className={cls}
        onClick={(e) => {
          e.preventDefault();
          void copy();
        }}
      >
        {copied ? 'Скопировано' : 'Скопировать ссылку'}
      </button>
      <button
        type="button"
        className={cls}
        onClick={(e) => {
          e.preventDefault();
          share();
        }}
      >
        Отправить в MAX
      </button>
    </span>
  );
}
