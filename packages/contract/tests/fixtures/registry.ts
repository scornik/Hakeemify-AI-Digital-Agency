/**
 * A fact registry shaped like a real small business: enough evidence to be interesting, not
 * enough to unlock everything. It deliberately fails `transformation` (2 before/after pairs,
 * not 4) and `proof_first` (1 attributable testimonial, not 3) so the Decision Manifest has
 * genuine `ruled_out` rows to project, and the Gap Report has something to ask for.
 */
import type { z } from 'zod';
import { FactRegistry } from '../../src/facts/registry.js';

const intake = (field: string) => ({ kind: 'intake' as const, field });
const upload = (file: string) => ({ kind: 'upload' as const, file, checked: true });

const photo = (
  name: string,
  width: number,
  height: number,
  extra: Record<string, unknown> = {},
) => ({
  path: `/assets/photos/${name}.jpg`,
  width,
  height,
  alt: `${name.replace(/-/g, ' ')}`,
  rights: 'owned' as const,
  subject_consent: false,
  tags: ['work'],
  grade_safe: true,
  ai_generated: false,
  ...extra,
});

export const rawRegistry = {
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
    story: {
      id: 'f_story',
      value:
        'Ridgeline Roofing was started in 1998 by Dana Whitlock after fifteen years on other ' +
        'crews. The company still works the same three valleys it started in, and still sends ' +
        'the same four-person crew to every job rather than subcontracting the difficult ones.',
      provenance: intake('story'),
      quotable: true,
      verification: 'self_reported',
    },
    response_time_promise: {
      id: 'f_response',
      value: 'We answer every enquiry within one working day',
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
    value: [
      {
        name: 'Dana Whitlock',
        role: 'Founder',
        is_founder: true,
        bio: 'Fifteen years on other crews before starting Ridgeline in 1998.',
        portrait: photo('dana-whitlock', 1600, 2000, {
          tags: ['person', 'portrait'],
          subject_consent: true,
        }),
      },
    ],
    provenance: intake('people'),
    quotable: true,
    verification: 'self_reported',
  },

  proof: {
    testimonials: {
      id: 'f_testimonials',
      value: [
        {
          quote: 'They found the leak two other roofers missed, and fixed it in a day.',
          author_name: 'Marta Kelleher',
          author_role: 'Homeowner, Ashfield',
          consented: true,
          verification: 'documented',
        },
        {
          quote: 'Tidy crew, fair price, no surprises on the invoice.',
          consented: false,
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
          summary: 'Slate replacement over a 1920s farmhouse',
          before_photo: photo('ashfield-before', 2000, 1333),
          after_photo: photo('ashfield-after', 2000, 1333),
          client_named: false,
          completed_at: '2026-04-18',
        },
        {
          title: 'Milbrook terrace storm repair',
          before_photo: photo('milbrook-before', 2000, 1333),
          after_photo: photo('milbrook-after', 2000, 1333),
          client_named: false,
          completed_at: '2026-06-02',
        },
        { title: 'Cheswick gutter renewal', client_named: false },
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
          identifier: 'PL-448120',
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
        photo('slate-detail', 1800, 2250),
        photo('van-and-ladders', 2000, 1333),
        photo('workshop', 1600, 1200, { grade_safe: false }),
        photo('unsourced-stock', 1200, 800, { rights: 'unknown' }),
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
    hours: {
      id: 'f_hours',
      value: [{ days: ['mon', 'tue', 'wed', 'thu', 'fri'], opens: '07:30', closes: '17:00' }],
      provenance: intake('hours'),
      quotable: true,
      verification: 'self_reported',
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
};

export type ParsedRegistry = z.infer<typeof FactRegistry>;

/** Parse once; derived fields (`attributable`, `has_before_after`, `aspect`) land here. */
export function parsedRegistry(): ParsedRegistry {
  return FactRegistry.parse(rawRegistry);
}
