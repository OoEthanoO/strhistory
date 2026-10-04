// Inline stroke icons and the globe's one button style (`.ui-btn`: a square glass button
// with an icon, the same surface as the timeline's controls). Ported from the Alex's
// Atlas reference site, apps/site/src/ui/dom.ts (`icon`, `iconButton`).
import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, JSX } from 'react';
import { ICONS, type IconName } from './icons';

export type { IconName } from './icons';

/** An inline 24×24 stroke icon, hidden from assistive technology. */
export function Icon({ name, className }: { name: IconName; className?: string }): JSX.Element {
  return (
    <svg className={className ?? 'icon'} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {ICONS[name].map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'type'> {
  icon: IconName;
  /** The accessible name. */
  label: string;
  /** The tooltip; defaults to the label. */
  title?: string;
}

/** A `.ui-btn` with an icon; `label` is its accessible name, `title` its tooltip. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, title, className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={'ui-btn' + (className ? ' ' + className : '')}
      aria-label={label}
      title={title ?? label}
      {...rest}
    >
      <Icon name={icon} />
    </button>
  );
});
