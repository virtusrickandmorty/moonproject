/**
 * The garments the website shop shows. Staff keep them in the ERP (Sales › Website shop, GET /api/shp/products); the
 * made-up SAMPLE_PRODUCTS below are shown only until the shop publishes its own. Prices are integer centavos, "from"
 * one piece; the shop confirms the real price on a quotation.
 */
export type Shape = 'tee' | 'polo' | 'jersey' | 'jacket' | 'hoodie' | 'shorts';
export type Category = string;
export interface Colour { name: string; hex: string }
export interface Product {
  id: string; name: string; category: Category; shape: Shape; priceCents: number; photoUrl?: string | null;
  madeToOrder: boolean; minQty: number; leadDays: number; badge?: string | null;
  colours: Colour[]; sizes: string[]; summary: string; features: string[];
}

export const SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'] as const;

const ink = { name: 'Ink', hex: '#1e293b' }, white = { name: 'White', hex: '#f8fafc' }, royal = { name: 'Royal', hex: '#1f3bb3' },
  red = { name: 'Red', hex: '#c0392b' }, forest = { name: 'Forest', hex: '#2f5d46' }, gold = { name: 'Gold', hex: '#d4a017' },
  sky = { name: 'Sky', hex: '#5fa8d3' }, maroon = { name: 'Maroon', hex: '#7b2135' }, grey = { name: 'Heather', hex: '#9aa3ad' };
const ALL = [...SIZES], CORE = ['S', 'M', 'L', 'XL', '2XL'];

export const SAMPLE_PRODUCTS: readonly Product[] = [
  { id: 'sublimated-jersey', name: 'Full-sublimation team jersey', category: 'Jerseys', shape: 'jersey', priceCents: 55_000,
    madeToOrder: true, minQty: 10, leadDays: 14, badge: 'Best seller', colours: [royal, red, ink, gold], sizes: ALL,
    summary: 'Your design printed edge to edge, with names and numbers for each player.', features: ['Breathable dri-fit', 'Names and numbers included', 'Colours that do not crack or fade'] },
  { id: 'basketball-set', name: 'Basketball uniform set', category: 'Uniform sets', shape: 'jersey', priceCents: 95_000,
    madeToOrder: true, minQty: 10, leadDays: 18, colours: [maroon, royal, forest, ink], sizes: ALL,
    summary: 'A jersey and shorts in matching fabric, made for league play.', features: ['Jersey and shorts', 'Mesh side panels', 'Per-player roster on the job ticket'] },
  { id: 'corporate-polo', name: 'Embroidered corporate polo', category: 'Polo shirts', shape: 'polo', priceCents: 42_000,
    madeToOrder: true, minQty: 12, leadDays: 12, badge: 'Office favourite', colours: [white, ink, royal, sky], sizes: CORE,
    summary: 'Honeycomb piqué with your logo embroidered on the chest.', features: ['Logo embroidery up to 4 inches', 'Reinforced collar', 'Men and women cuts'] },
  { id: 'dri-fit-polo', name: 'Dri-fit event polo', category: 'Polo shirts', shape: 'polo', priceCents: 38_000,
    madeToOrder: true, minQty: 20, leadDays: 10, colours: [sky, red, gold, white], sizes: ALL,
    summary: 'Light and quick-drying, for fun runs, outings and events.', features: ['Moisture-wicking', 'Heat-press or print logo', 'Good for outdoor events'] },
  { id: 'classic-tee', name: 'Classic cotton tee', category: 'Shirts', shape: 'tee', priceCents: 22_000,
    madeToOrder: false, minQty: 1, leadDays: 2, colours: [white, ink, grey, red], sizes: ALL,
    summary: 'A soft everyday tee, ready to wear or to print on.', features: ['Combed cotton', 'Ready stock', 'Add a print anytime'] },
  { id: 'printed-tee', name: 'Screen-printed shirt', category: 'Shirts', shape: 'tee', priceCents: 26_000,
    madeToOrder: true, minQty: 24, leadDays: 7, badge: 'Bulk deal', colours: [white, ink, forest, maroon], sizes: ALL,
    summary: 'Bold prints for orgs, families and reunions.', features: ['Up to 4 print colours', 'Front and back print', 'Lower price per piece at 50+'] },
  { id: 'varsity-jacket', name: 'Varsity jacket', category: 'Jackets & hoodies', shape: 'jacket', priceCents: 185_000,
    madeToOrder: true, minQty: 6, leadDays: 21, colours: [maroon, ink, royal, forest], sizes: CORE,
    summary: 'Classic varsity cut with chenille or embroidered patches.', features: ['Quilted lining', 'Rib-knit collar and cuffs', 'Custom patches'] },
  { id: 'windbreaker', name: 'Team windbreaker', category: 'Jackets & hoodies', shape: 'jacket', priceCents: 98_000,
    madeToOrder: true, minQty: 10, leadDays: 14, colours: [ink, royal, red, gold], sizes: ALL,
    summary: 'Water-resistant shell for the road and the bench.', features: ['Water-resistant', 'Zip pockets', 'Packs into its own pouch'] },
  { id: 'pullover-hoodie', name: 'Pullover hoodie', category: 'Jackets & hoodies', shape: 'hoodie', priceCents: 75_000,
    madeToOrder: false, minQty: 1, leadDays: 3, colours: [grey, ink, maroon], sizes: ALL,
    summary: 'Warm fleece hoodie with a kangaroo pocket.', features: ['Brushed fleece inside', 'Ready stock', 'Add embroidery on request'] },
  { id: 'school-uniform', name: 'School uniform set', category: 'Uniform sets', shape: 'polo', priceCents: 68_000,
    madeToOrder: true, minQty: 30, leadDays: 25, colours: [white, sky, forest], sizes: ALL,
    summary: 'Top and bottom made to your school’s pattern and colours.', features: ['Measured or standard sizing', 'Name tags available', 'Re-orders keep your pattern'] },
  { id: 'training-shorts', name: 'Training shorts', category: 'Uniform sets', shape: 'shorts', priceCents: 28_000,
    madeToOrder: false, minQty: 1, leadDays: 2, colours: [ink, royal, red], sizes: ALL,
    summary: 'Light shorts with an elastic waist, ready to ship.', features: ['Elastic drawstring waist', 'Side pockets', 'Ready stock'] },
  { id: 'esports-jersey', name: 'Esports jersey', category: 'Jerseys', shape: 'tee', priceCents: 49_000,
    madeToOrder: true, minQty: 5, leadDays: 12, badge: 'New', colours: [ink, royal, gold], sizes: ALL,
    summary: 'Full-print jersey with gamer tags on the back.', features: ['Full sublimation', 'Gamer tag and number', 'Small team minimum'] },
];

/** Body measurements in inches for the size guide (chest is measured around, length from shoulder to hem). */
export const SIZE_CHART: { size: string; chest: number; length: number; shoulder: number }[] = [
  { size: 'XS', chest: 34, length: 26, shoulder: 15.5 }, { size: 'S', chest: 36, length: 27, shoulder: 16 },
  { size: 'M', chest: 38, length: 28, shoulder: 17 }, { size: 'L', chest: 40, length: 29, shoulder: 18 },
  { size: 'XL', chest: 42, length: 30, shoulder: 19 }, { size: '2XL', chest: 44, length: 31, shoulder: 20 },
  { size: '3XL', chest: 46, length: 32, shoulder: 21 },
];

/** Where a quotation request goes. Placeholders: the owner fills in the shop's real contact details. */
export const SHOP_CONTACT = { email: 'orders@example.com', phone: '0900 000 0000', hours: 'Monday to Saturday, 8 AM to 6 PM' };

/** Categories in the order their first product appears. */
export const categoriesOf = (products: readonly Product[]) => [...new Set(products.map((p) => p.category))];
