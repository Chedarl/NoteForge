import "server-only";

/**
 * Explicit bootstrap gate for the platform administrator.
 *
 * The first public signup is never implicitly privileged. Set this value to the
 * intended owner's address before that person signs up; the database flag then
 * becomes the durable authorization source.
 */
export function isBootstrapPlatformAdmin(email: string): boolean {
  const configured = process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
  return Boolean(configured && configured === email.trim().toLowerCase());
}
