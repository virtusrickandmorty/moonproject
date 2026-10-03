/**
 * What search engines read about each page of the website: the title, the description, the canonical address, the
 * link-preview tags (Open Graph) and structured data (schema.org JSON-LD) for the shop, its products and its services.
 * Set from the page while it shows; the ERP's own title comes back when the website is left. Only real facts go in:
 * a placeholder contact (example.com, 0900 000 0000) is left out, and ratings come only from buyers' reviews.
 */
import { useEffect } from 'react';
import type { Product } from './products.ts';
import { SHOP_CONTACT } from './products.ts';
import type { Review } from './store.tsx';

export const BRAND = 'Virtus Garments';
const LD_ID = 'seo-jsonld';

export interface Seo {
  title: string;
  description: string;
  /** The page's own address, like /services (no query: one address per page). */
  path: string;
  /** false for pages that should not be listed: order pages (they carry a secret link), checkout, tracking. */
  index?: boolean;
  jsonLd?: object[];
}

const origin = () => window.location.origin;
function meta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) { el = document.createElement('meta'); el.setAttribute(attr, key); document.head.appendChild(el); }
  el.content = content;
}
function canonical(href: string) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!el) { el = document.createElement('link'); el.rel = 'canonical'; document.head.appendChild(el); }
  el.href = href;
}

/** Sets the page's search-engine tags while it shows. */
export function useSeo(seo: Seo) {
  const key = JSON.stringify(seo);
  useEffect(() => {
    const url = origin() + seo.path;
    document.title = seo.title;
    meta('name', 'description', seo.description);
    meta('name', 'robots', seo.index === false ? 'noindex, nofollow' : 'index, follow');
    canonical(url);
    meta('property', 'og:type', 'website');
    meta('property', 'og:site_name', BRAND);
    meta('property', 'og:title', seo.title);
    meta('property', 'og:description', seo.description);
    meta('property', 'og:url', url);
    meta('property', 'og:image', `${origin()}/icon-512.png`);
    meta('name', 'twitter:card', 'summary');
    document.getElementById(LD_ID)?.remove();
    if (seo.jsonLd?.length) {
      const s = document.createElement('script');
      s.type = 'application/ld+json'; s.id = LD_ID;
      // "<" escaped so a product name can never close the script tag.
      s.textContent = JSON.stringify(seo.jsonLd.length === 1 ? seo.jsonLd[0] : { '@context': 'https://schema.org', '@graph': seo.jsonLd }).replace(/</g, '\\u003c');
      document.head.appendChild(s);
    }
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Leaving the website (to the ERP): its title and tags go back to the app's own. */
export function useSeoReset() {
  useEffect(() => {
    const before = document.title;
    return () => {
      document.title = before.includes('Virtus') && !before.includes('|') ? before : 'Virtus';
      document.getElementById(LD_ID)?.remove();
      document.head.querySelector('link[rel="canonical"]')?.remove();
      meta('name', 'robots', 'noindex, nofollow');
    };
  }, []);
}

const real = (v: string) => !/example\.(com|org)|0900 000 0000|\[/.test(v);

/** The shop itself, as a clothing store. */
export function storeLd(): object {
  return {
    '@context': 'https://schema.org', '@type': 'ClothingStore', '@id': `${origin()}/#store`, name: BRAND, url: `${origin()}/`,
    logo: `${origin()}/virtus-logo.png`, image: `${origin()}/icon-512.png`,
    description: 'Team jerseys, uniforms, custom prints and own-brand ready-to-wear, made in our own workshop in the Philippines.',
    address: { '@type': 'PostalAddress', addressCountry: 'PH' }, currenciesAccepted: 'PHP',
    ...(real(SHOP_CONTACT.phone) ? { telephone: SHOP_CONTACT.phone } : {}),
    ...(real(SHOP_CONTACT.email) ? { email: SHOP_CONTACT.email } : {}),
    openingHours: 'Mo-Sa 08:00-18:00',
  };
}

/** A product with its price, stock and (when buyers have rated it) its rating and latest reviews. */
export function productLd(p: Product, reviews: readonly Review[]): object {
  const mine = reviews.filter((r) => r.productId === p.id);
  const inStock = !p.stock || p.stock.some((s) => s.available > 0);
  return {
    '@type': 'Product', name: p.name, description: p.summary, category: p.category, brand: { '@type': 'Brand', name: BRAND },
    ...(p.photoUrl ? { image: new URL(p.photoUrl, origin()).href } : {}),
    offers: {
      '@type': 'Offer', priceCurrency: 'PHP', price: (p.priceCents / 100).toFixed(2), url: `${origin()}/`,
      availability: p.madeToOrder ? 'https://schema.org/PreOrder' : inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      seller: { '@id': `${origin()}/#store` },
    },
    ...(mine.length ? {
      aggregateRating: { '@type': 'AggregateRating', ratingValue: (mine.reduce((n, r) => n + r.rating, 0) / mine.length).toFixed(1), reviewCount: mine.length, bestRating: 5, worstRating: 1 },
      review: mine.slice(0, 5).map((r) => ({ '@type': 'Review', author: { '@type': 'Person', name: r.name }, datePublished: r.at.slice(0, 10),
        reviewRating: { '@type': 'Rating', ratingValue: r.rating, bestRating: 5 }, ...(r.title ? { name: r.title } : {}), reviewBody: r.body })),
    } : {}),
  };
}

/** The shop's products as a list (the samples shown before the shop publishes its own are left out). */
export function productListLd(products: readonly Product[], reviews: readonly Review[]): object {
  return { '@type': 'ItemList', name: `${BRAND} shop`, itemListElement: products.map((p, i) => ({ '@type': 'ListItem', position: i + 1, item: productLd(p, reviews) })) };
}

/** The services, each one a Service the store provides. */
export function servicesLd(services: readonly { id: string; name: string; detail: string }[]): object {
  return {
    '@type': 'OfferCatalog', name: `${BRAND} services`,
    itemListElement: services.map((s) => ({ '@type': 'Offer', itemOffered: { '@type': 'Service', '@id': `${origin()}/services#${s.id}`, name: s.name, description: s.detail, provider: { '@id': `${origin()}/#store` }, areaServed: 'PH' } })),
  };
}

/** Where the page sits on the site, for the breadcrumb under its search result. */
export function breadcrumbLd(trail: [string, string][]): object {
  return { '@type': 'BreadcrumbList', itemListElement: trail.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: origin() + path })) };
}
