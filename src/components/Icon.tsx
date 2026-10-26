import { icon } from '../icons';
/** Static, application-owned SVG paths; user data never enters this markup. */
export function Icon({ name }: { name: string }) {
  return (
    <span className="icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: icon(name) }} />
  );
}
