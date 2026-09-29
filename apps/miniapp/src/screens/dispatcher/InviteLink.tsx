import { useState } from 'react';
import { useExecutorInvite } from '../../api/hooks';
import type { Executor } from '../../api/types';
import { shareToMax } from '../../bridge';
import { copyText } from '../../ui';

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
  // Временно, для проверки на ПК и телефоне: почему MAX не открыл «Поделиться»
  const [shareError, setShareError] = useState<string | null>(null);
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
  const copy = () => {
    void copyText(url).then((ok) => {
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  const share = () => {
    const text = `${executor.nameShort}, наряды по заявкам будут приходить в этот бот.`;
    setShareError(null);
    // Без await до вызова: MAX принимает шаринг только прямо из нажатия
    void shareToMax({ text, link: url }).then((err) => err && setShareError(err));
  };

  return (
    <span className="row wrap" style={{ gap: 8 }}>
      <button
        type="button"
        className={cls}
        onClick={(e) => {
          e.preventDefault();
          copy();
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
      {shareError && (
        <span className="field__error" role="alert">
          Не удалось поделиться: {shareError}
        </span>
      )}
    </span>
  );
}
