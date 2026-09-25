import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Ссылка на документ с временной подписью.
 *
 * Кнопка в мини-приложении открывает PDF обычным переходом, а браузер не отправляет
 * заголовок с данными входа — API отвечал 401. Поэтому адрес документа подписывается
 * на короткий срок: открыть его можно без заголовка, но недолго и только тот документ,
 * для которого подпись выдана.
 */
export type DocumentKind = 'claim' | 'gji';

export const linkTtlMs = Number(process.env.DOC_LINK_TTL_MIN ?? 30) * 60_000;

const signature = (requestId: string, kind: DocumentKind, exp: number, secret: string): string =>
  createHmac('sha256', secret).update(`${requestId}|${kind}|${exp}`).digest('base64url');

export function signedDocumentPath(
  requestId: string,
  kind: DocumentKind,
  now: Date,
  secret: string,
): string {
  const exp = now.getTime() + linkTtlMs;
  const sig = signature(requestId, kind, exp, secret);
  return `/api/requests/${requestId}/documents/${kind}.pdf?exp=${exp}&sig=${sig}`;
}

export interface SignedLinkCheck {
  ok: boolean;
  reason?: 'expired' | 'bad_signature';
}

export function checkSignedLink(
  requestId: string,
  kind: DocumentKind,
  query: { exp?: string; sig?: string },
  now: Date,
  secret: string,
): SignedLinkCheck {
  const exp = Number(query.exp);
  if (!query.sig || !Number.isFinite(exp)) return { ok: false, reason: 'bad_signature' };
  if (exp < now.getTime()) return { ok: false, reason: 'expired' };

  const expected = Buffer.from(signature(requestId, kind, exp, secret));
  const given = Buffer.from(query.sig);
  // Длины сравниваем отдельно: timingSafeEqual бросает исключение на разной длине.
  const ok = expected.length === given.length && timingSafeEqual(expected, given);
  return ok ? { ok: true } : { ok: false, reason: 'bad_signature' };
}
