/**
 * The gate context for the two fixture sites.
 *
 * This is what the SiteDefinition and the FactRegistry would supply on a real build. The whole
 * value of the gate is comparing what shipped against what the contract said should ship, so
 * these expectations are declared here rather than derived from the HTML under test.
 */
import type { GateContext } from '../../src/context.js';

const ORIGIN = 'https://ridgelineroofing.example';

const QUOTABLE_FACTS = [
  { id: 'f_legal_name', path: 'business.legal_name', text: 'Ridgeline Roofing Ltd' },
  { id: 'f_founded', path: 'business.founded_year', text: '1998' },
  { id: 'f_phone', path: 'contact.phone', text: '01632 960144' },
  { id: 'f_email', path: 'contact.email', text: 'office@ridgelineroofing.example' },
  {
    id: 'f_address',
    path: 'contact.address',
    text: '4 Kiln Lane Ashfield Northants NN12 8QP GB',
  },
  {
    id: 'f_credentials',
    path: 'proof.credentials',
    text: 'Public liability insurance Brightwater Underwriting PL-448120 Competent Roofer scheme member National Federation of Roofing Contractors',
  },
  {
    id: 'f_services',
    path: 'services',
    text: 'Roof replacement Storm damage repair Gutter renewal',
  },
  {
    id: 'f_response',
    path: 'business.response_time_promise',
    text: 'We answer every enquiry within one working day',
  },
  // The build year is grounded in the build itself, not the registry. It is listed so the
  // footer copyright does not read as an unsupported figure.
  { id: 'f_build_year', path: 'build.year', text: '2026' },
];

const HOME_SECTIONS = [
  {
    sdId: 's_hero',
    family: 'hero',
    variantId: 'hero/service_statement',
    arrangementId: 'stacked-left',
  },
  {
    sdId: 's_services',
    family: 'services',
    variantId: 'services/plain_list',
    arrangementId: 'two-column',
  },
  {
    sdId: 's_proof',
    family: 'proof',
    variantId: 'proof/credential_bar',
    arrangementId: 'inline-row',
  },
  {
    sdId: 's_faq',
    family: 'faq',
    variantId: 'faq/native_disclosure',
    arrangementId: 'single-column',
  },
  { sdId: 's_cta', family: 'cta', variantId: 'cta/direct_contact', arrangementId: 'split-detail' },
].map((section) => ({ ...section, sdPath: `pages.home.sections.${section.sdId}` }));

const baseContext: GateContext = {
  origin: ORIGIN,
  quotableFacts: QUOTABLE_FACTS,
  businessName: 'Ridgeline Roofing Ltd',
  contact: {
    phone: '01632 960144',
    email: 'office@ridgelineroofing.example',
    addressLines: ['4 Kiln Lane', 'Ashfield', 'NN12 8QP'],
  },
  artDirectionGradeId: 'warm_lift',
  jsBudgetBytes: 184_320,
  allowedHosts: ['fonts.googleapis.com', 'fonts.gstatic.com'],
  legalRoutes: ['/privacy'],
  buildYear: 2026,
  consentRequired: false,
  pages: [],
};

export const cleanContext: GateContext = {
  ...baseContext,
  pages: [
    {
      route: '/',
      archetype: 'service_clarity',
      title: 'Ridgeline Roofing — roof replacement and storm repair in Ashfield',
      description:
        'A four-person roofing crew working the same three valleys since 1998. Roof replacement, storm damage repair and gutter renewal across Ashfield.',
      canonical: `${ORIGIN}/`,
      indexable: true,
      sections: HOME_SECTIONS,
      minSections: 5,
      maxSections: 9,
      lcpSdId: 's_hero',
    },
    {
      route: '/privacy',
      archetype: 'service_clarity',
      title: 'Privacy policy — how Ridgeline Roofing handles your data',
      description:
        'How Ridgeline Roofing collects, stores and deletes the personal data you send us in an enquiry, and who to contact about it.',
      canonical: `${ORIGIN}/privacy`,
      indexable: true,
      sections: [
        {
          sdId: 's_legal',
          family: 'footer',
          variantId: 'footer/legal_text',
          arrangementId: 'single-column',
          sdPath: 'pages.privacy.sections.s_legal',
        },
      ],
      minSections: 1,
      maxSections: 9,
      lcpSdId: null,
    },
  ],
};

/**
 * The broken site's context declares two pages with identical titles and descriptions, which is
 * how `seo.title-unique` and `seo.description-unique` are made to fail: uniqueness is a property
 * of the SiteDefinition, not of the rendered page, so it is asserted before anything deploys.
 */
export const brokenContext: GateContext = {
  ...baseContext,
  legalRoutes: ['/privacy'],
  pages: [
    {
      route: '/',
      archetype: 'service_clarity',
      title: 'Roofing services from a crew that turns up when it says it will',
      description:
        'Roof replacement, storm damage repair and gutter renewal across the three valleys, from the same four-person crew every time.',
      canonical: `${ORIGIN}/`,
      indexable: true,
      sections: HOME_SECTIONS,
      minSections: 5,
      maxSections: 9,
      lcpSdId: 's_hero',
    },
    {
      route: '/services',
      archetype: 'service_clarity',
      title: 'Roofing services from a crew that turns up when it says it will',
      description:
        'Roof replacement, storm damage repair and gutter renewal across the three valleys, from the same four-person crew every time.',
      canonical: `${ORIGIN}/services`,
      indexable: true,
      sections: [
        {
          sdId: 's_hero',
          family: 'hero',
          variantId: 'hero/service_statement',
          arrangementId: 'stacked-left',
          sdPath: 'pages.services.sections.s_hero',
        },
      ],
      minSections: 1,
      maxSections: 9,
      lcpSdId: 's_hero',
    },
  ],
};
