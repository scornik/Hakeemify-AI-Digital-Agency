/**
 * `variant_id` -> component.
 *
 * A resolver map rather than a dynamic import path, so an unknown variant fails at build time
 * with the id that was asked for, instead of rendering nothing. Craft.js's resolver, and its
 * invariant-on-miss, for the same reason: a silently missing section is a page that shipped
 * with a hole in it.
 */
import HeroServiceStatement from '../../assets/sections/hero/service_statement/service_statement.astro';
import ServicesPlainList from '../../assets/sections/services/plain_list/plain_list.astro';
import ProofCredentialBar from '../../assets/sections/proof/credential_bar/credential_bar.astro';
import FaqNativeDisclosure from '../../assets/sections/faq/native_disclosure/native_disclosure.astro';
import CtaDirectContact from '../../assets/sections/cta/direct_contact/direct_contact.astro';

/** Astro components are opaque to TypeScript; the map's job is resolution, not typing. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const SECTION_REGISTRY: Record<string, any> = {
  'hero/service_statement': HeroServiceStatement,
  'services/plain_list': ServicesPlainList,
  'proof/credential_bar': ProofCredentialBar,
  'faq/native_disclosure': FaqNativeDisclosure,
  'cta/direct_contact': CtaDirectContact,
};

export class UnknownVariantError extends Error {
  constructor(variantId: string) {
    super(
      `no component registered for variant "${variantId}". The SiteDefinition selected a section ` +
        'the renderer cannot draw, which is a library/pipeline mismatch, not a content problem.',
    );
    this.name = 'UnknownVariantError';
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function resolveVariant(variantId: string): any {
  const component = SECTION_REGISTRY[variantId];
  if (!component) throw new UnknownVariantError(variantId);
  return component;
}
