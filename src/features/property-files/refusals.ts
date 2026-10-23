// Which answer from the file workspace's own endpoints takes the person off the page. Only a
// refusal that names their access does: an unauthenticated session, or the session guard's own
// answer. Everything else is about this record, this file or this operation, and is stated in
// the panel the person is working in.
export function sessionLost(problem: {
  status: number;
  code: string;
}): boolean {
  return (
    problem.status === 401 ||
    (problem.status === 403 && problem.code === 'access-denied')
  );
}
