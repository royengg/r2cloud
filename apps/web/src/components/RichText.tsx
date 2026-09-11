import { lazy, Suspense } from 'react';
const Markdown = lazy(() => import('react-markdown'));
export function RichText({ children }: { children: string }) {
  return (
    <Suspense fallback={<p>{children}</p>}>
      <Markdown
        skipHtml
        disallowedElements={['img']}
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {children}
      </Markdown>
    </Suspense>
  );
}
