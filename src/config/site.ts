/**
 * Site-wide settings: names, navigation, contact details.
 * Change the department's identity here rather than in individual pages.
 */
export const site = {
  /** Brand shown in the header and page titles. */
  name: 'STR History',
  department: 'History Department',
  /** Full school name. Left empty until confirmed; pages hide it when empty. */
  school: '',
  tagline: 'IB History, mapped.',
  description:
    'An interactive globe of IB History topics with study notes, plus courses, teachers and news from the history department.',
  /** Public contact for the department. Empty hides the contact line. */
  email: '',
  /** Source repository, linked from the About page. */
  repo: 'https://github.com/OoEthanoO/strhistory',
} as const;

export type NavItem = { href: string; label: string };

export const nav: NavItem[] = [
  { href: '/globe', label: 'Globe' },
  { href: '/topics', label: 'Notes' },
  { href: '/glossary', label: 'Glossary' },
  { href: '/courses', label: 'Courses' },
  { href: '/teachers', label: 'Teachers' },
  { href: '/news', label: 'News' },
  { href: '/resources', label: 'Resources' },
];

export const footerNav: NavItem[] = [...nav, { href: '/about', label: 'About' }];
