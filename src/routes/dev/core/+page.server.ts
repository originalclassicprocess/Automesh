import { dev } from '$app/environment';
import { error, redirect } from '@sveltejs/kit';

export function load() {
  if (!dev) error(404, 'Not found');
  redirect(307, '/diagnostics/core');
}
