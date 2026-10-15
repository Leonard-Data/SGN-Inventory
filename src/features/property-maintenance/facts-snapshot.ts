export function shouldAdoptFactsSnapshot(
  savedRevision: string | null,
  snapshotRevision: string,
  incomingRevision: string,
) {
  return (
    savedRevision === snapshotRevision && incomingRevision !== snapshotRevision
  );
}
