'use client';
import { useState, type FormEvent } from 'react';
import { messages, label, type Locale } from '@/i18n/messages';
import { useProtectedData } from '@/features/employees/use-protected-data';
import { LoadingSkeleton } from '@/features/skeleton';
import { api, RequestError } from './api';
import {
  EMPLOYEE_BIO_MAX_LENGTH,
  EMPLOYEE_NAME_MAX_LENGTH,
  parseMyProfile,
  profileProblems,
  type MyProfileValues,
  type ProfileProblem,
} from './profile';

type MyProfileRecord = {
  displayName: string;
  role: string;
  bio: string | null;
};

// The signed-in person's own profile: display name and bio, nothing else. It reads and writes
// /api/profile, which resolves the subject from live membership, so there is no employee here
// to name and the route cannot reach anyone else's record.
export function MyProfile({ initialLocale }: { initialLocale: Locale }) {
  const { data, error, busy, surface, logout, reload } =
    useProtectedData<MyProfileRecord>('/api/profile');
  const text = messages[initialLocale];
  const [draft, setDraft] = useState<MyProfileValues | null>(null);
  const [problems, setProblems] = useState<ProfileProblem[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // The recorded values seed the form until the person starts editing, so a later reload never
  // overwrites what they are typing.
  const values = draft ?? {
    displayName: data?.displayName ?? '',
    bio: data?.bio ?? '',
  };
  const displayName = values.displayName;
  const bio = values.bio;
  const edit = (patch: Partial<MyProfileValues>) =>
    setDraft({ ...values, ...patch });

  const problemMessage = (item: ProfileProblem) =>
    item.code === 'required'
      ? text.employeeProfileNameRequired
      : item.code === 'plain-text'
        ? text.employeeProfilePlainText
        : item.field === 'displayName'
          ? text.employeeProfileNameTooLong
          : item.field === 'phone'
            ? text.employeeProfilePhoneTooLong
            : text.employeeProfileBioTooLong;
  const nameProblem = problems.find((item) => item.field === 'displayName');
  const bioProblem = problems.find((item) => item.field === 'bio');

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const found = profileProblems({ displayName, bio }, ['displayName', 'bio']);
    setProblems(found);
    setProblem(null);
    setNotice(null);
    if (found.length) return;
    setSaving(true);
    try {
      const saved = parseMyProfile(
        await api<unknown>('/api/profile', { displayName, bio }),
      );
      if (!saved) {
        setProblem(text.unavailable);
        return;
      }
      setDraft({ displayName: saved.displayName, bio: saved.bio ?? '' });
      setNotice(text.employeeProfileSaved);
      // The account menu shows this name, so tell it the recorded name changed.
      window.dispatchEvent(
        new CustomEvent('sgn-profile', {
          detail: { displayName: saved.displayName },
        }),
      );
    } catch (failure) {
      if (
        failure instanceof RequestError &&
        (failure.status === 401 || failure.status === 403)
      ) {
        window.location.replace(
          failure.status === 403 ? '/access-denied' : '/login',
        );
        return;
      }
      setProblem(
        failure instanceof RequestError
          ? failure.code === 'invalid-input'
            ? text.invalidInput
            : text.employeeProfileFailed
          : text.unavailable,
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div className="page-intro">
          <p className="example">{text.people}</p>
          <h1>{text.employeeProfileTitle}</h1>
          <p className="intro-copy">{text.employeeProfileIntro}</p>
        </div>
      </div>

      {error ? (
        <div className="alert" data-tone="danger" role="alert">
          <span>
            {error === 'invalid-input'
              ? text.invalidInput
              : error === 'sign-out-failed'
                ? text.signOutFailed
                : error === 'access-changed'
                  ? text.accessChanged
                  : text.employeeProfileLoadFailed}
          </span>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={error === 'sign-out-failed' ? logout : reload}
          >
            {text.retry}
          </button>
        </div>
      ) : null}

      {busy ? (
        <LoadingSkeleton
          label={text.loading}
          className="panel page-section"
          shape="rows"
          rows={3}
        />
      ) : null}

      <div ref={surface} hidden={!data || busy}>
        {data ? (
          <section className="panel page-section" aria-labelledby="my-profile">
            <div className="panel-head">
              <h2 id="my-profile">{text.employeeProfileTitle}</h2>
            </div>
            <div className="panel-body">
              <form onSubmit={save} noValidate>
                <fieldset disabled={saving} className="stack-4">
                  <div className="field">
                    <label className="field-label" htmlFor="my-profile-name">
                      {text.employeeName} <span className="field-req">*</span>
                    </label>
                    <input
                      id="my-profile-name"
                      className="input"
                      name="displayName"
                      type="text"
                      autoComplete="name"
                      maxLength={EMPLOYEE_NAME_MAX_LENGTH}
                      value={displayName}
                      aria-invalid={nameProblem ? 'true' : undefined}
                      aria-describedby={
                        nameProblem
                          ? 'my-profile-name-error'
                          : 'my-profile-name-hint'
                      }
                      onChange={(event) =>
                        edit({ displayName: event.target.value })
                      }
                    />
                    {nameProblem ? (
                      <p
                        className="field-error"
                        id="my-profile-name-error"
                        role="alert"
                      >
                        {problemMessage(nameProblem)}
                      </p>
                    ) : (
                      <p className="field-hint" id="my-profile-name-hint">
                        {text.employeeProfileNameHint}
                      </p>
                    )}
                  </div>
                  <div className="field">
                    <label className="field-label" htmlFor="my-profile-bio">
                      {text.employeeBio}
                    </label>
                    <textarea
                      id="my-profile-bio"
                      className="textarea"
                      name="bio"
                      rows={3}
                      maxLength={EMPLOYEE_BIO_MAX_LENGTH}
                      value={bio}
                      aria-invalid={bioProblem ? 'true' : undefined}
                      aria-describedby={
                        bioProblem
                          ? 'my-profile-bio-error'
                          : 'my-profile-bio-hint'
                      }
                      onChange={(event) => edit({ bio: event.target.value })}
                    />
                    {bioProblem ? (
                      <p
                        className="field-error"
                        id="my-profile-bio-error"
                        role="alert"
                      >
                        {problemMessage(bioProblem)}
                      </p>
                    ) : (
                      <p className="field-hint" id="my-profile-bio-hint">
                        {text.employeeProfileBioHint}
                      </p>
                    )}
                  </div>
                  <p className="field-hint">{text.employeeProfileEmailNote}</p>
                </fieldset>
                {problem ? (
                  <p role="alert" className="field-error">
                    {problem}
                  </p>
                ) : null}
                {notice ? (
                  <p className="panel-note" role="status">
                    {notice}
                  </p>
                ) : null}
                <div className="form-foot">
                  <button className="btn btn-primary" type="submit">
                    {saving ? text.saving : text.employeeProfileSave}
                  </button>
                </div>
              </form>
              <dl className="summary-list">
                <div className="summary-row">
                  <dt>{text.employeeRole}</dt>
                  <dd>{label(initialLocale, data.role)}</dd>
                </div>
              </dl>
            </div>
          </section>
        ) : null}
      </div>
    </>
  );
}
