/** The public website shown before sign-in: the store, the services and the support page under one header. */
import { formatPeso } from '@moonproject/shared';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, navigate, useLocation } from '../router.tsx';
import { About } from './About.tsx';
import { Checkout, MyOrders, OrderStatus, rememberedOrders } from './Checkout.tsx';
import { Track } from './Track.tsx';
import { CartDrawer, QuickView, SizeGuide, WishlistDrawer } from './Panels.tsx';
import { SERVICES, Services } from './Services.tsx';
import { BRAND, breadcrumbLd, productListLd, servicesLd, storeLd, useSeo, useSeoReset, type Seo } from './seo.ts';
import { Store } from './Storefront.tsx';
import { Support } from './Support.tsx';
import { SHOP_CONTACT, type Product } from './products.ts';
import { ShopProvider, useShop } from './store.tsx';

/** The addresses this site answers before sign-in; every other one asks staff to sign in. */
export const SITE_PATHS = ['/', '/shop', '/services', '/about', '/support', '/checkout', '/orders', '/track'];
/** A customer's order page: /order/WEB-000123 (opened with its secret link). */
const ORDER_PAGE = /^\/order\/([A-Z]+-\d{1,9})$/;
/** Whether the website answers this address: for everyone, or (staff) beside the ERP, whose home page is `/`. */
export const isSitePath = (path: string, staff = false) => (SITE_PATHS.includes(path) && !(staff && path === '/')) || ORDER_PAGE.test(path);
export type Panel = 'cart' | 'wishlist' | 'sizes' | null;
export interface SiteControls { openPanel: (p: Panel) => void; view: (p: Product) => void; toast: (text: string) => void }

/** What search engines read about the page at this address. */
function seoFor(path: string, shop: ReturnType<typeof useShop>): Seo {
  const fees = shop.payment?.deliveryOptions ?? [];
  const home: [string, string] = ['Shop', '/'];
  if (path === '/services') return {
    path, title: `Custom Embroidery, Sublimation, Cut and Sew & T-shirt Printing | ${BRAND}`,
    description: 'Embroidery, full sublimation jerseys, cut and sew uniforms, T-shirt printing, DTF, patches, pattern making and design, made in our own workshop. Request a free quotation with a design proof.',
    jsonLd: [storeLd(), servicesLd(SERVICES), breadcrumbLd([home, ['Services', path]])],
  };
  if (path === '/about') return {
    path, title: `About Us | ${BRAND}: Team Wear and Uniforms Made to Order`,
    description: `${BRAND} makes team jerseys, school and office uniforms and custom garments in its own workshop: design, cutting, printing, sewing and embroidery under one roof.${shop.reviews.length ? ` Rated ${(shop.reviews.reduce((n, r) => n + r.rating, 0) / shop.reviews.length).toFixed(1)} of 5 by ${shop.reviews.length} verified buyer${shop.reviews.length === 1 ? "" : "s"}.` : ''}`,
    jsonLd: [storeLd(), { '@type': 'AboutPage', name: `About ${BRAND}`, about: { '@id': `${window.location.origin}/#store` } }, breadcrumbLd([home, ['About us', path]])],
  };
  if (path === '/support') return {
    path, title: `Customer Support and Quotation Requests | ${BRAND}`,
    description: 'Ask a question, send feedback or request a quotation for team jerseys, uniforms and custom prints, with pictures of your design. A person at the shop reads every message.',
    jsonLd: [storeLd(), breadcrumbLd([home, ['Customer support', path]])],
  };
  if (path === '/track') return { path, index: false, title: `Track Your Order | ${BRAND}`, description: 'See where your online order or job order is, by its number.' };
  if (path !== '/' && path !== '/shop') return { path, index: false, title: `Your Order | ${BRAND}`, description: `Your order at ${BRAND}.` };
  const online = !!shop.payment && !shop.samples;
  return {
    path: '/', title: `${BRAND} | Team Jerseys, Uniforms & Custom Apparel${online ? ' – Shop Online' : ''}`,
    description: `Shop own-brand ready-to-wear and order custom team jerseys, uniforms and printed shirts from ${BRAND}.${online ? ` Pay online by ${shop.payment!.bankName} QR${fees.length ? `, delivery from ${formatPeso(Math.min(...fees.map((d) => d.feeCents)))}` : ''}.` : ''} Free quotation with a design proof.`,
    jsonLd: [storeLd(), ...(shop.samples || !shop.products.length ? [] : [productListLd(shop.products, shop.reviews)])],
  };
}

function Layout({ staff }: { staff: boolean }) {
  const NAV: [string, string][] = [[staff ? '/shop' : '/', 'Shop'], ['/services', 'Services'], ['/about', 'About us'], ['/support', 'Support'], ['/track', 'Track order']];
  const shop = useShop();
  const [path = '/', query = ''] = useLocation().split('?');
  useSeoReset();
  useSeo(seoFor(path, shop));
  const [panel, setPanel] = useState<Panel>(null);
  const [viewing, setViewing] = useState<Product | null>(null);
  const [toast, setToast] = useState('');
  const showToast = (text: string) => { setToast(text); setTimeout(() => setToast((t) => (t === text ? '' : t)), 2500); };
  const controls: SiteControls = { openPanel: setPanel, view: setViewing, toast: showToast };
  const order = ORDER_PAGE.exec(path);
  const page: ReactNode = order ? <OrderStatus key={path} number={order[1]!} query={query} />
    : path === '/checkout' ? <Checkout /> : path === '/orders' ? <MyOrders /> : path === '/track' ? <Track key={query} query={query} />
    : path === '/services' ? <Services /> : path === '/about' ? <About /> : path === '/support' ? <Support key={query} query={query} /> : <Store {...controls} />;
  const icon = 'relative grid size-10 place-items-center rounded-full hover:bg-slate-100';
  const home = staff ? '/shop' : '/';
  const [searching, setSearching] = useState(false);
  const [text, setText] = useState('');
  const search = (e: FormEvent) => { e.preventDefault(); navigate(`${home}?q=${encodeURIComponent(text.trim())}`); setSearching(false); };
  // The strip along the top says what the shop really offers: QR payment and its delivery fees, or quotations.
  const fees = shop.payment?.deliveryOptions ?? [];
  const news = shop.payment && !shop.samples
    ? [`Order online, pay by ${shop.payment.bankName} QR`, fees.length ? `Delivery: ${fees.map((d) => `${d.name} ${formatPeso(d.feeCents)}`).join(' · ')}` : 'Pick up at the shop', 'Team orders: free quotation with a design proof']
    : ['Team wear, uniforms and custom prints, made to order', 'Free quotation with a design proof'];

  return (
    <div className="min-h-screen bg-[#fafaf8] text-slate-900">
      <div className="bg-slate-950 text-white">
        <p className="mx-auto flex max-w-7xl items-center justify-center gap-x-6 overflow-hidden whitespace-nowrap px-4 py-2 text-xs font-semibold tracking-wide sm:px-6">
          {news.map((n, i) => <span key={n} className={i ? 'hidden md:inline' : ''}>{i > 0 && <span className="mr-6 text-white/30">•</span>}{n}</span>)}
        </p>
      </div>
      <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-4 py-3 sm:flex-nowrap sm:gap-6 sm:px-6">
          <Link to="/" className="flex shrink-0 items-center" aria-label="Virtus Garments home"><img src="/virtus-logo.png" alt="Virtus" className="h-9 w-auto" /></Link>
          {/* On a phone the links get a row of their own under the logo. */}
          <nav className="order-last -mx-1 flex w-full items-center gap-0.5 overflow-x-auto sm:order-none sm:mx-0 sm:w-auto sm:gap-1 lg:mx-auto" aria-label="Website">
            {NAV.map(([to, label]) => { const on = path === to || (to === '/' && path === '/shop'); return <Link key={to} to={to} aria-current={on ? 'page' : undefined}
              className={`relative shrink-0 whitespace-nowrap px-3 py-2 text-sm font-semibold transition after:absolute after:inset-x-3 after:bottom-0.5 after:h-0.5 after:origin-left after:rounded-full after:bg-slate-900 after:transition-transform ${on ? 'text-slate-900 after:scale-x-100' : 'text-slate-500 after:scale-x-0 hover:text-slate-900 hover:after:scale-x-100'}`}>{label}</Link>; })}
          </nav>
          <div className="ml-auto flex items-center gap-1 sm:gap-1.5 lg:ml-0">
            {searching
              ? <form onSubmit={search} role="search" className="flex items-center"><input autoFocus type="search" value={text} onChange={(e) => setText(e.target.value)} onBlur={() => { if (!text) setSearching(false); }}
                  placeholder="Search garments…" aria-label="Search garments" className="w-36 rounded-full bg-slate-100 px-4 py-2 text-sm outline-none ring-indigo-500 focus:ring-2 sm:w-52" /></form>
              : <button type="button" onClick={() => setSearching(true)} className={icon} aria-label="Search">
                  <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true"><path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm9 2-4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
                </button>}
            {/* Orders placed from this browser: their pages open from here again. */}
            {rememberedOrders().length > 0 && <Link to="/orders" className="whitespace-nowrap rounded-full px-3 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50">My orders</Link>}
            <button type="button" onClick={() => setPanel('wishlist')} className={icon} aria-label={`Wishlist, ${shop.wishlist.length} saved`}>
              <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true"><path d="M12 20s-7-4.4-9.2-8.6C1.2 8.2 3.2 4.5 6.8 4.5c2 0 3.4 1.1 4.2 2.4h2c.8-1.3 2.2-2.4 4.2-2.4 3.6 0 5.6 3.7 4 6.9C19 15.6 12 20 12 20Z" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>
              {shop.wishlist.length > 0 && <span className="absolute -right-0.5 -top-0.5 grid size-5 place-items-center rounded-full bg-rose-600 text-[10px] font-bold text-white">{shop.wishlist.length}</span>}
            </button>
            <button type="button" onClick={() => setPanel('cart')} className={icon} aria-label={`Cart, ${shop.cartCount} pieces`}>
              <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true"><path d="M5 7h14l-1.2 11.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8L5 7Zm3 0a4 4 0 0 1 8 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
              {shop.cartCount > 0 && <span className="absolute -right-1 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-indigo-600 px-1 text-[10px] font-bold text-white">{shop.cartCount > 99 ? '99+' : shop.cartCount}</span>}
            </button>
            <Link to={staff ? '/' : '/sign-in'} className="ml-1 whitespace-nowrap rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">{staff ? 'Back to the ERP' : 'Staff sign in'}</Link>
          </div>
        </div>
      </header>

      <main>{page}</main>

      <footer className="mt-16 bg-slate-950 text-slate-400">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="grid gap-4 border-b border-white/10 py-12 md:grid-cols-[1.4fr_1fr] md:items-center">
            <div><p className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">Outfitting a team?</p>
              <p className="mt-2 max-w-lg">Send us your list and your design. We reply with a quotation and a design proof, free.</p></div>
            <div className="flex flex-wrap gap-3 md:justify-end">
              <Link to="/support?type=quotation" className="rounded-full bg-white px-6 py-3 font-bold text-slate-900 hover:bg-indigo-100">Get a quotation</Link>
              <Link to="/services" className="rounded-full px-6 py-3 font-bold text-white ring-1 ring-white/25 hover:bg-white/10">Our services</Link>
            </div>
          </div>
          <div className="grid gap-8 py-12 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div><span className="inline-block rounded-xl bg-white p-2"><img src="/virtus-logo.png" alt="Virtus" className="h-8 w-auto" /></span><p className="mt-4">Team wear, uniforms and custom garments, made in our own workshop.</p></div>
            <div className="space-y-2"><p className="font-bold text-white">Shop</p>
              <p><Link to={home} className="hover:text-white">All garments</Link></p>
              {rememberedOrders().length > 0 && <p><Link to="/orders" className="hover:text-white">My orders</Link></p>}
              <p><Link to="/track" className="hover:text-white">Track an order</Link></p></div>
            <div className="space-y-2"><p className="font-bold text-white">Company</p>
              <p><Link to="/services" className="hover:text-white">Services</Link></p>
              <p><Link to="/about" className="hover:text-white">About us</Link></p>
              <p><Link to="/support" className="hover:text-white">Customer support</Link></p>
              <p><Link to={staff ? '/' : '/sign-in'} className="hover:text-white">{staff ? 'Back to the ERP' : 'Staff sign in'}</Link></p></div>
            <div className="space-y-2"><p className="font-bold text-white">Talk to us</p><p>{SHOP_CONTACT.email}</p><p>{SHOP_CONTACT.phone}</p><p>{SHOP_CONTACT.hours}</p></div>
          </div>
          <p className="border-t border-white/10 py-6 text-xs">© Virtus Garments · Ready-stock prices are final and include VAT; made-to-order prices are confirmed on your quotation.</p>
        </div>
      </footer>

      {viewing && <QuickView key={viewing.id} product={viewing} onClose={() => setViewing(null)} onSizeGuide={() => setPanel('sizes')}
        onAdded={() => { setViewing(null); showToast(`Added ${viewing.name} to your cart`); }} />}
      {panel === 'sizes' && <SizeGuide onClose={() => setPanel(null)} />}
      {panel === 'cart' && <CartDrawer onClose={() => setPanel(null)} />}
      {panel === 'wishlist' && <WishlistDrawer onClose={() => setPanel(null)} onOpen={(p) => { setPanel(null); setViewing(p); }} />}
      {toast && <div role="status" className="fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-xl">{toast} · <button type="button" className="underline" onClick={() => { setToast(''); setPanel('cart'); }}>View cart</button></div>}
    </div>
  );
}

/** `staff`: a signed-in user looking at the website. */
export function Site({ staff = false }: { staff?: boolean }) {
  return <ShopProvider><Layout staff={staff} /></ShopProvider>;
}
