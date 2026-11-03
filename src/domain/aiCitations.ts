/**
 * The AI search summary cites posts by their place in the list the app sent, like “[10]” or
 * “[3, 6]”. Citations are renumbered 1, 2, 3 in the order they first appear, so the markers in the
 * answer and the sources under it read in order and always match. Markers that point at no post are
 * dropped rather than shown.
 */
export type CitedPiece = { text: string } | { cite: number; postId: string };

export interface CitedAnswer { pieces: CitedPiece[]; sources: string[] }

const marker = /\s*\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\]/g;

export function citedAnswer(answer: string, sentIds: string[]): CitedAnswer {
  const sources: string[] = [];
  const pieces: CitedPiece[] = [];
  const pushText = (text: string) => {
    if (!text) return;
    const last = pieces[pieces.length - 1];
    if (last && 'text' in last) last.text += text; else pieces.push({ text });
  };
  let from = 0;
  for (const match of answer.matchAll(marker)) {
    pushText(answer.slice(from, match.index));
    from = match.index + match[0].length;
    const ids = match[1].split(',').map((part) => sentIds[Number(part.trim()) - 1]).filter((id): id is string => Boolean(id));
    for (const postId of new Set(ids)) {
      if (!sources.includes(postId)) sources.push(postId);
      pieces.push({ cite: sources.indexOf(postId) + 1, postId });
    }
  }
  pushText(answer.slice(from));
  return { pieces, sources };
}
