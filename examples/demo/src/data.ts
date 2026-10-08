/**
 * A fictional company ("Kestrel Systems", ~100 people) shaped to exercise every part of the layout:
 * - large flat teams (Web: 9 ICs, Design: 4 ICs) → compact two-column grids;
 * - small teams (Mobile: 2 ICs) and single reports (Brand, FP&A) → never compacted;
 * - mixed groups: Payments interleaves ICs with two sub-team leads, SRE has a lead + an IC;
 * - a deep chain (CEO → … → SRE I, 9 levels);
 * - one manager with 30 direct reports (Customer Support) → paging.
 * Bios are the "variable size" knob: measure mode renders them, so card heights differ.
 */

export type Department =
  | 'Executive'
  | 'Engineering'
  | 'Product'
  | 'Design'
  | 'Finance'
  | 'Operations'
  | 'Customer Support'
  | 'Marketing'
  | 'People';

export interface Person {
  id: string;
  parentId: string | null;
  name: string;
  title: string;
  department: Department;
  location: string;
  /** Avatar initials; derived from the name when absent. */
  initials?: string;
  /** Free-text bio. Only rendered in measure mode, where it makes card heights vary. */
  bio?: string;
}

export const DEPARTMENT_COLORS: Readonly<Record<Department, string>> = {
  Executive: '#4f46e5',
  Engineering: '#0284c7',
  Product: '#7c3aed',
  Design: '#db2777',
  Finance: '#059669',
  Operations: '#d97706',
  'Customer Support': '#ea580c',
  Marketing: '#e11d48',
  People: '#0d9488',
};

export function initialsOf(person: Pick<Person, 'name' | 'initials'>): string {
  if (person.initials) return person.initials;
  const parts = person.name.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

type Extra = Pick<Person, 'initials' | 'bio'>;

function person(
  id: string,
  parentId: string | null,
  name: string,
  title: string,
  department: Department,
  location: string,
  extra: Extra = {},
): Person {
  return { id, parentId, name, title, department, location, ...extra };
}

const SUPPORT_TEAM: ReadonlyArray<readonly [name: string, location: string]> = [
  ['Aaliyah Jordan', 'Austin'],
  ['Bruno Costa', 'Lisbon'],
  ['Chiara Bianchi', 'Milan'],
  ['Dmitri Volkov', 'Berlin'],
  ['Esther Adeyemi', 'Lagos'],
  ['Farhan Qureshi', 'Dubai'],
  ['Gabriela Ortiz', 'Mexico City'],
  ['Hugo Lefebvre', 'Paris'],
  ['Imani Wright', 'Atlanta'],
  ['Jakub Nowak', 'Warsaw'],
  ['Keiko Sato', 'Tokyo'],
  ['Luis Ramírez', 'Bogotá'],
  ['Mariam Haidari', 'Toronto'],
  ['Niklas Berg', 'Stockholm'],
  ['Olivia Turner', 'Denver'],
  ['Pavel Horák', 'Prague'],
  ['Quinn Harper', 'Seattle'],
  ['Rosa Delgado', 'Madrid'],
  ['Sanjay Iyer', 'Bengaluru'],
  ['Tamar Cohen', 'Tel Aviv'],
  ['Uma Krishnan', 'Singapore'],
  ['Valentina Greco', 'Rome'],
  ['William Foster', 'Chicago'],
  ['Xiu Ying Liu', 'Shanghai'],
  ['Yara Nasser', 'Amman'],
  ['Zoltan Szabo', 'Budapest'],
  ['Adele Fontaine', 'Montréal'],
  ['Bilal Hussain', 'Manchester'],
  ['Carmen Vidal', 'Barcelona'],
  ['Dae-jung Han', 'Seoul'],
];

const supportTeam: Person[] = SUPPORT_TEAM.map(([name, location], i) =>
  person(
    `cs-${String(i + 1).padStart(2, '0')}`,
    'm-support',
    name,
    i % 10 === 0 ? 'Senior Support Specialist' : i % 3 === 0 ? 'Support Specialist II' : 'Support Specialist',
    'Customer Support',
    location,
    i % 7 === 3 ? { bio: 'Tier-2 escalations and billing disputes; runs the weekly macro clean-up.' } : {},
  ),
);

/** Row order = child order (the layout keeps siblings in input order). */
export const PEOPLE: readonly Person[] = [
  person('ceo', null, 'Amara Okafor', 'Chief Executive Officer', 'Executive', 'San Francisco', {
    bio: 'Co-founded Kestrel in 2016 after a decade building logistics software. Spends Fridays with customers and still reviews every launch plan herself.',
  }),

  // ── Executives
  person('cto', 'ceo', 'Daniel Reyes', 'Chief Technology Officer', 'Engineering', 'San Francisco', {
    bio: 'Former distributed-systems researcher. Owns architecture, reliability and the platform roadmap.',
  }),
  person('cfo', 'ceo', 'Priya Raman', 'Chief Financial Officer', 'Finance', 'New York'),
  person('coo', 'ceo', 'Marcus Lindqvist', 'Chief Operating Officer', 'Operations', 'Stockholm', {
    bio: 'Scaled support and IT from 5 to 40 people across three continents.',
  }),
  person('cpo', 'ceo', 'Sofia Moreau', 'Chief Product Officer', 'Product', 'Paris'),
  person('cmo', 'ceo', 'Kenji Watanabe', 'Chief Marketing Officer', 'Marketing', 'Tokyo'),
  person('chro', 'ceo', 'Grace Mensah', 'Chief People Officer', 'People', 'London', {
    bio: 'Built the hiring loop, the leveling framework and the remote-first handbook.',
  }),

  // ── Engineering: Platform (deep chain)
  person('d-plat', 'cto', 'Hannah Becker', 'Director, Platform Engineering', 'Engineering', 'Berlin'),
  person('m-infra', 'd-plat', 'Tomás Alvarez', 'Senior Manager, Infrastructure', 'Engineering', 'Madrid'),
  person('m-sre', 'm-infra', 'Leila Haddad', 'Manager, Site Reliability', 'Engineering', 'Amsterdam', {
    bio: 'Runs the on-call rotation and the incident review program. Ask her about error budgets.',
  }),
  person('tl-rel', 'm-sre', 'Oliver Grant', 'Tech Lead, Reliability', 'Engineering', 'Dublin'),
  person('ic-staff-sre', 'tl-rel', 'Mei Chen', 'Staff Site Reliability Engineer', 'Engineering', 'Vancouver', {
    bio: 'Designed the multi-region failover. Mentors the reliability guild and maintains the chaos-testing suite that runs every night against staging.',
  }),
  person('ic-sre2', 'ic-staff-sre', 'Jonas Weber', 'Site Reliability Engineer II', 'Engineering', 'Munich'),
  person('ic-sre1', 'ic-sre2', 'Aisha Bello', 'Site Reliability Engineer I', 'Engineering', 'Lagos', {
    bio: 'Joined through the apprenticeship program last spring.',
  }),
  person('ic-oncall', 'm-sre', 'Ravi Patel', 'Site Reliability Engineer II', 'Engineering', 'Pune'),

  // ── Engineering: Product Engineering
  person('d-prod-eng', 'cto', 'Noah Thompson', 'Director, Product Engineering', 'Engineering', 'Toronto'),
  person('m-web', 'd-prod-eng', 'Chloe Martin', 'Engineering Manager, Web', 'Engineering', 'Lyon', {
    bio: 'Leads the web app team; previously front-end lead at a design-tools startup.',
  }),
  person('web-1', 'm-web', 'Ethan Brooks', 'Senior Frontend Engineer', 'Engineering', 'Portland'),
  person('web-2', 'm-web', 'Yuki Tanaka', 'Frontend Engineer', 'Engineering', 'Osaka'),
  person('web-3', 'm-web', 'Lucas Silva', 'Frontend Engineer', 'Engineering', 'São Paulo', {
    bio: 'Accessibility champion. Wrote the keyboard-navigation guidelines used across all Kestrel products, and runs a monthly screen-reader testing session.',
  }),
  person('web-4', 'm-web', 'Zara Ahmed', 'Senior Frontend Engineer', 'Engineering', 'London'),
  person('web-5', 'm-web', 'Felix Wagner', 'Full-Stack Engineer', 'Engineering', 'Vienna'),
  person('web-6', 'm-web', 'Isabella Rossi', 'Frontend Engineer', 'Engineering', 'Turin'),
  person('web-7', 'm-web', 'Samuel Kim', 'Design Systems Engineer', 'Engineering', 'Seoul', {
    bio: 'Maintains the component library.',
  }),
  person('web-8', 'm-web', 'Nadia Petrova', 'Frontend Engineer', 'Engineering', 'Sofia'),
  person('web-9', 'm-web', 'Diego Fernández', 'Frontend Engineer', 'Engineering', 'Buenos Aires'),
  person('m-mobile', 'd-prod-eng', 'Benjamin Clarke', 'Engineering Manager, Mobile', 'Engineering', 'Sydney'),
  person('mob-1', 'm-mobile', 'Ana Costa', 'iOS Engineer', 'Engineering', 'Porto'),
  person('mob-2', 'm-mobile', 'Ibrahim Yusuf', 'Android Engineer', 'Engineering', 'Nairobi'),
  person('m-pay', 'd-prod-eng', 'Elena Novak', 'Engineering Manager, Payments', 'Engineering', 'Ljubljana', {
    bio: 'Owns checkout, invoicing and fraud. Her team ships behind feature flags and reviews every payment-path change in pairs.',
  }),
  // Mixed group: ICs interleaved with sub-team leads (the compact block anchors at the first leaf).
  person('pay-1', 'm-pay', 'Arjun Mehta', 'Backend Engineer', 'Engineering', 'Hyderabad'),
  person('tl-fraud', 'm-pay', 'Sara Lindgren', 'Team Lead, Fraud', 'Engineering', 'Gothenburg'),
  person('fraud-1', 'tl-fraud', 'Mateo Herrera', 'Data Engineer', 'Engineering', 'Santiago'),
  person('fraud-2', 'tl-fraud', 'Fatima Zahra', 'Machine Learning Engineer', 'Engineering', 'Casablanca', {
    bio: 'Trains the transaction-risk models.',
  }),
  person('pay-2', 'm-pay', 'Lina Johansson', 'Backend Engineer', 'Engineering', 'Oslo'),
  person('tl-billing', 'm-pay', 'Owen Murphy', 'Team Lead, Billing', 'Engineering', 'Cork'),
  person('bill-1', 'tl-billing', 'Clara Dubois', 'Backend Engineer', 'Engineering', 'Brussels'),
  person('bill-2', 'tl-billing', 'Hiro Nakamura', 'Backend Engineer', 'Engineering', 'Kyoto'),
  person('pay-3', 'm-pay', 'Kwame Asante', 'QA Engineer', 'Engineering', 'Accra'),

  // ── Finance
  person('m-ctrl', 'cfo', 'Robert Hayes', 'Controller', 'Finance', 'New York'),
  person('fin-1', 'm-ctrl', 'Monica Tran', 'Senior Accountant', 'Finance', 'Boston'),
  person('fin-2', 'm-ctrl', 'Paul Dimitrov', 'Accountant', 'Finance', 'Philadelphia'),
  person('m-fpa', 'cfo', 'Julia Schmidt', 'FP&A Lead', 'Finance', 'Zurich', {
    bio: 'Builds the quarterly plan and the board pack.',
  }),
  person('fin-3', 'm-fpa', 'Andre Mbeki', 'Financial Analyst', 'Finance', 'Cape Town'),

  // ── Operations (incl. the 30-person support team)
  person('d-cx', 'coo', 'Natalie Kowalski', 'Director, Customer Experience', 'Customer Support', 'Kraków', {
    bio: 'Owns support, onboarding and the customer health score. Previously ran support operations at two marketplaces and introduced follow-the-sun coverage here.',
  }),
  person('m-support', 'd-cx', 'Carlos Mendoza', 'Support Manager', 'Customer Support', 'Mexico City'),
  ...supportTeam,
  person('cx-ops', 'd-cx', 'Ingrid Olsen', 'CX Operations Analyst', 'Customer Support', 'Bergen'),
  person('m-it', 'coo', 'Wei Zhang', 'IT Manager', 'Operations', 'Singapore'),
  person('it-1', 'm-it', 'Lucy Evans', 'IT Specialist', 'Operations', 'Cardiff'),
  person('it-2', 'm-it', 'Mohammed Al-Farsi', 'Systems Administrator', 'Operations', 'Muscat'),

  // ── Product & Design
  person('m-gpm', 'cpo', 'Isabel Navarro', 'Group Product Manager', 'Product', 'Valencia'),
  person('pm-1', 'm-gpm', "Liam O'Connor", 'Product Manager, Growth', 'Product', 'Galway'),
  person('pm-2', 'm-gpm', 'Maya Singh', 'Product Manager, Payments', 'Product', 'Delhi', {
    bio: 'Shipped one-click invoicing and the new pricing page.',
  }),
  person('pm-3', 'm-gpm', 'Jae-won Park', 'Product Manager, Platform', 'Product', 'Busan'),
  person('m-design', 'cpo', 'Camille Laurent', 'Design Manager', 'Design', 'Paris'),
  person('des-1', 'm-design', 'Inês Carvalho', 'Senior Product Designer', 'Design', 'Lisbon'),
  person('des-2', 'm-design', 'Theo Walsh', 'Product Designer', 'Design', 'Edinburgh'),
  person('des-3', 'm-design', 'Amira Saleh', 'UX Researcher', 'Design', 'Cairo', {
    bio: 'Runs the customer interview program: twelve sessions a month, synthesised into a shared insight library that every squad reads before planning.',
  }),
  person('des-4', 'm-design', 'Jasper Lee', 'Content Designer', 'Design', 'Melbourne'),

  // ── Marketing
  person('m-growth', 'cmo', 'Ava Robinson', 'Growth Marketing Manager', 'Marketing', 'Austin'),
  person('mkt-1', 'm-growth', 'Leo Fischer', 'Performance Marketer', 'Marketing', 'Hamburg'),
  person('mkt-2', 'm-growth', 'Nora Kelly', 'Lifecycle Marketer', 'Marketing', 'Belfast'),
  person('mkt-3', 'm-growth', 'Sven Larsen', 'Marketing Analyst', 'Marketing', 'Copenhagen'),
  person('m-brand', 'cmo', 'Bianca Romano', 'Brand Lead', 'Marketing', 'Milan'),
  person('mkt-4', 'm-brand', 'Oscar Pérez', 'Brand Designer', 'Marketing', 'Seville'),

  // ── People
  person('m-recruit', 'chro', 'Hassan Karimi', 'Recruiting Manager', 'People', 'Toronto'),
  person('ppl-1', 'm-recruit', 'Emily Zhou', 'Technical Recruiter', 'People', 'Vancouver'),
  person('ppl-2', 'm-recruit', 'Kofi Boateng', 'Recruiting Coordinator', 'People', 'Kumasi'),
  person('ppl-3', 'chro', 'Laura Svensson', 'HR Business Partner', 'People', 'Malmö'),
];

export const PEOPLE_BY_ID: ReadonlyMap<string, Person> = new Map(PEOPLE.map((p) => [p.id, p]));

export interface ReportCounts {
  direct: number;
  total: number;
}

/** Direct and total report counts over the full data (independent of what is expanded). */
export function computeReportCounts(people: readonly Person[]): Map<string, ReportCounts> {
  const children = new Map<string, string[]>();
  for (const p of people) {
    if (p.parentId === null) continue;
    const list = children.get(p.parentId);
    if (list) list.push(p.id);
    else children.set(p.parentId, [p.id]);
  }
  const counts = new Map<string, ReportCounts>();
  const visit = (id: string): number => {
    const kids = children.get(id) ?? [];
    let total = kids.length;
    for (const kid of kids) total += visit(kid);
    counts.set(id, { direct: kids.length, total });
    return total;
  };
  const root = people.find((p) => p.parentId === null);
  if (root) visit(root.id);
  return counts;
}
