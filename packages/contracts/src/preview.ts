import { requireThat } from './domain';

export function previewOrigin(domain: string, id: string) {
  requireThat(
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(domain),
    503,
    'The preview domain is not configured.',
  );
  requireThat(
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id),
    404,
    'Preview not found.',
  );
  return `https://${id}.${domain}`;
}
export type LivePreviewStatus = {
  preview: { id: string; state: string; error: string | null; expiresAt: string } | null;
};
