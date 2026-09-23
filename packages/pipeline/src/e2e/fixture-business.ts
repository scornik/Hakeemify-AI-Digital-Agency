/**
 * The fixture business.
 *
 * Real-shaped facts for a small roofing company: enough evidence to build a coherent site, and
 * deliberately not enough to unlock everything. Two before/after pairs where `transformation`
 * wants four; one attributable testimonial where `proof_first` wants three; five gradeable
 * photos where `documentary_real` wants twelve; no third-party metric, so `leader` is closed.
 *
 * That shortfall is the point. A fixture that satisfied every gate would prove the pipeline can
 * build a site and prove nothing about the parts that matter — the ruled-out rows in the
 * manifest and the unlocks in the Gap Report.
 */
export const FIXTURE_ORIGIN = 'https://ridgelineroofing.example';

const intake = (field: string) => ({ kind: 'intake' as const, field });
const upload = (file: string) => ({ kind: 'upload' as const, file, checked: true });

const photo = (
  name: string,
  width: number,
  height: number,
  extra: Record<string, unknown> = {},
) => ({
  path: `/photos/${name}.jpg`,
  width,
  height,
  aspect: width / height,
  alt: name.replace(/-/g, ' '),
  rights: 'owned' as const,
  subject_consent: false,
  tags: ['work'],
  grade_safe: true,
  ai_generated: false,
  ...extra,
});

export const FIXTURE_REGISTRY = {
  business: {
    legal_name: {
      id: 'f_legal_name',
      value: 'Ridgeline Roofing Ltd',
      provenance: intake('legal_name'),
      quotable: true,
      verification: 'documented',
    },
    type: {
      id: 'f_type',
      value: 'local_service',
      provenance: intake('type'),
      quotable: false,
      verification: 'self_reported',
    },
    niche: {
      id: 'f_niche',
      value: 'roofing',
      provenance: intake('niche'),
      quotable: false,
      verification: 'self_reported',
    },
    positioning: {
      id: 'f_positioning',
      value: 'local_trust',
      provenance: intake('positioning'),
      quotable: false,
      verification: 'self_reported',
    },
    founded_year: {
      id: 'f_founded',
      value: 1998,
      provenance: intake('founded_year'),
      quotable: true,
      verification: 'documented',
    },
    response_time_promise: {
      id: 'f_response',
      value: 'We answer every enquiry within one working day.',
      provenance: intake('response_time_promise'),
      quotable: true,
      verification: 'self_reported',
    },
  },
  services: {
    id: 'f_services',
    value: [
      { name: 'Roof replacement', summary: 'Full tear-off and replacement', is_primary: true },
      { name: 'Storm damage repair', summary: 'Emergency make-safe and repair', is_primary: false },
      { name: 'Gutter renewal', summary: 'Seamless gutter and fascia renewal', is_primary: false },
    ],
    provenance: intake('services'),
    quotable: true,
    verification: 'self_reported',
  },
  people: {
    id: 'f_people',
    value: [{ name: 'Dana Whitlock', role: 'Founder', is_founder: true }],
    provenance: intake('people'),
    quotable: true,
    verification: 'self_reported',
  },
  proof: {
    testimonials: {
      id: 'f_testimonials',
      value: [
        {
          quote: 'They found the leak two other roofers missed.',
          author_name: 'Marta Kelleher',
          consented: true,
          attributable: true,
          verification: 'documented',
        },
        {
          quote: 'Tidy crew, fair price.',
          consented: false,
          attributable: false,
          verification: 'self_reported',
        },
      ],
      provenance: upload('testimonials.csv'),
      quotable: true,
      verification: 'documented',
    },
    projects: {
      id: 'f_projects',
      value: [
        {
          title: 'Ashfield farmhouse re-roof',
          before_photo: { path: '/photos/a-before.jpg' },
          after_photo: { path: '/photos/a-after.jpg' },
        },
        {
          title: 'Milbrook terrace storm repair',
          before_photo: { path: '/photos/m-before.jpg' },
          after_photo: { path: '/photos/m-after.jpg' },
        },
        { title: 'Cheswick gutter renewal' },
      ],
      provenance: upload('projects.csv'),
      quotable: true,
      verification: 'documented',
    },
    metrics: {
      id: 'f_metrics',
      value: [
        { label: 'Roofs completed', value: 412, verification: 'self_reported' },
        { label: 'Years trading', value: 27, verification: 'documented' },
      ],
      provenance: intake('metrics'),
      quotable: true,
      verification: 'self_reported',
    },
    credentials: {
      id: 'f_credentials',
      value: [
        {
          name: 'Public liability insurance',
          issuer: 'Brightwater Underwriting',
          verification: 'documented',
        },
        {
          name: 'Competent Roofer scheme member',
          issuer: 'National Federation of Roofing Contractors',
          verification: 'third_party',
        },
      ],
      provenance: upload('insurance.pdf'),
      quotable: true,
      verification: 'documented',
    },
    clients: {
      id: 'f_clients',
      value: [],
      provenance: intake('clients'),
      quotable: true,
      verification: 'self_reported',
    },
  },
  media: {
    photos: {
      id: 'f_photos',
      value: [
        photo('crew-on-ridge', 2400, 1600),
        photo('ashfield-after', 2000, 1333),
        photo('milbrook-after', 2000, 1333),
        photo('slate-detail', 1800, 1200),
        photo('van-and-ladders', 2000, 1333),
        photo('workshop', 1600, 1200, { grade_safe: false }),
        photo('unsourced', 1200, 800, { rights: 'unknown' }),
      ],
      provenance: upload('photos.zip'),
      quotable: false,
      verification: 'self_reported',
    },
  },
  contact: {
    email: {
      id: 'f_email',
      value: 'office@ridgelineroofing.example',
      provenance: intake('email'),
      quotable: true,
      verification: 'documented',
    },
    phone: {
      id: 'f_phone',
      value: '01632 960144',
      provenance: intake('phone'),
      quotable: true,
      verification: 'documented',
    },
    address: {
      id: 'f_address',
      value: {
        street: '4 Kiln Lane',
        locality: 'Ashfield',
        region: 'Northants',
        postal_code: 'NN12 8QP',
        country: 'GB',
      },
      provenance: intake('address'),
      quotable: true,
      verification: 'documented',
    },
  },
  legal: {
    entity_jurisdiction: {
      id: 'f_jurisdiction',
      value: 'England and Wales',
      provenance: intake('entity_jurisdiction'),
      quotable: true,
      verification: 'documented',
    },
    privacy_contact: {
      id: 'f_privacy_contact',
      value: 'privacy@ridgelineroofing.example',
      provenance: intake('privacy_contact'),
      quotable: true,
      verification: 'documented',
    },
  },
  faq: {
    id: 'f_faq',
    value: [
      {
        question: 'How long does a re-roof take?',
        answer: 'Most take three to five working days.',
      },
      {
        question: 'Do you clear up afterwards?',
        answer: 'Yes, the site is cleared and swept before we leave.',
      },
    ],
    provenance: intake('faq'),
    quotable: true,
    verification: 'self_reported',
  },
};

/** The renderer reads facts by id; this is the flat view it gets. */
export function fixtureFacts(): Record<string, { id: string; value: unknown; quotable: boolean }> {
  const out: Record<string, { id: string; value: unknown; quotable: boolean }> = {};
  const walk = (node: unknown): void => {
    if (typeof node !== 'object' || node === null || Array.isArray(node)) return;
    const record = node as Record<string, unknown>;
    if ('id' in record && 'value' in record && 'provenance' in record) {
      out[String(record['id'])] = {
        id: String(record['id']),
        value: record['value'],
        quotable: record['quotable'] === true,
      };
      return;
    }
    for (const child of Object.values(record)) walk(child);
  };
  walk(FIXTURE_REGISTRY);
  return out;
}

export const FIXTURE_ASSETS = {
  crew_on_ridge: {
    asset_id: 'crew_on_ridge',
    path: '/photos/crew-on-ridge.jpg',
    width: 2400,
    height: 1600,
    aspect: 1.5,
    alt: 'Two roofers setting slate along a ridge line on a clear morning',
    rights: 'owned',
    subject_consent: true,
    ai_generated: false,
    tags: ['work'],
    grade_id: 'warm_lift',
  },
};

export const FIXTURE_SEO = {
  title: 'Ridgeline Roofing — roofing and storm repair, Ashfield',
  description:
    'A four-person roofing crew working the same three valleys since 1998. Roof replacement, storm damage repair and gutter renewal across Ashfield.',
  canonical: `${FIXTURE_ORIGIN}/`,
  og: {
    title: 'Ridgeline Roofing',
    description: 'Roof replacement and storm repair in Ashfield since 1998.',
    image: '/og/home.png',
    type: 'website',
  },
  robots: { index: true, follow: true },
  schema_org: [
    {
      type: 'LocalBusiness',
      data: {
        '@context': 'https://schema.org',
        '@type': 'RoofingContractor',
        name: 'Ridgeline Roofing Ltd',
        telephone: '01632 960144',
        url: `${FIXTURE_ORIGIN}/`,
        address: {
          '@type': 'PostalAddress',
          streetAddress: '4 Kiln Lane',
          addressLocality: 'Ashfield',
          postalCode: 'NN12 8QP',
          addressCountry: 'GB',
        },
      },
    },
  ],
};

export const FIXTURE_LEGAL = {
  entity_jurisdiction: 'England and Wales',
  privacy_contact: 'privacy@ridgelineroofing.example',
};
