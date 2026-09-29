import { Link } from 'react-router-dom';
import type { RequestSummary } from '../../api/types';
import { fmtDate, plural } from '../../lib/format';
import { closedStatuses, statusLabel, statusTone } from '../../lib/request';
import { Chip } from '../../ui';
import { IconChevron } from '../../ui/icons';

/** Заявка в списке: номер и статус сверху, суть крупно, место и срок подписью */
export function RequestRow({ r }: { r: RequestSummary }) {
  const closed = closedStatuses.includes(r.status);
  const total = r.joinersCount + 1;
  return (
    <Link to={`/requests/${r.id}`} className="card req">
      <div className="req__top">
        <span className="req__num num">№&nbsp;{r.number}</span>
        <Chip tone={r.overdue ? 'danger' : statusTone[r.status]} solid={r.overdue}>
          {r.overdue ? 'Срок вышел' : statusLabel[r.status]}
        </Chip>
      </div>
      <div className="req__title">{r.title}</div>
      <div className="req__meta">
        <span>{r.locationText}</span>
        {total > 1 && (
          <span className="num">
            {total} {plural(total, 'квартира', 'квартиры', 'квартир')}
          </span>
        )}
        {!closed && <span className="num">срок до {fmtDate(r.dueAt)}</span>}
      </div>
      <IconChevron size={18} className="chev req__chev" />
    </Link>
  );
}
