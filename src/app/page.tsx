import Link from 'next/link';
import { messages } from '@/i18n/messages';

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  const locale = (await searchParams).lang === 'en' ? 'en' : 'vi';
  const text = messages[locale];
  return (
    <main lang={locale}>
      <p className="brand">{text.title}</p>
      <h1>{text.heading}</h1>
      <p>{text.description}</p>
      <nav aria-label={text.language}>
        <Link
          href="/?lang=vi"
          lang="vi"
          aria-current={locale === 'vi' ? 'page' : undefined}
        >
          Tiếng Việt
        </Link>
        <Link
          href="/?lang=en"
          lang="en"
          aria-current={locale === 'en' ? 'page' : undefined}
        >
          English
        </Link>
      </nav>
      <p className="setup">{text.setup}</p>
    </main>
  );
}
