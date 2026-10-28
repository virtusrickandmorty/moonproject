/**
 * The shop's terms and conditions (the owner's request, 26 Oct 2026), shown at /terms. Drafted from how the shop
 * already works in this system: free quotations valid 15 days, a 50% downpayment to start a job order and the balance
 * before release, deposits taken before a job order kept 30 days, online orders held 24 hours while paid by QR, an ID
 * at release, and items brought back decided as free, for a fee or declined. Edit the words here; the page follows.
 * `UPDATED` is the date shown on the page: change it with every change of substance.
 */
export const TERMS_UPDATED = '2026-10-26';

export interface TermsSection { id: string; title: string; summary: string; points: string[] }

export const TERMS: TermsSection[] = [
  {
    id: 'about', title: 'About these terms',
    summary: 'They apply to every quotation, job order, shop purchase and online order.',
    points: [
      'These terms are between you and Virtus Garments Inc. ("Virtus", "we", "us"), Sta. Rosa Tagaytay Road, Puting Kahoy, Silang, Cavite.',
      'They cover quotations and design proofs, made-to-order job orders, ready-stock items bought at the shop, and orders placed on this website.',
      'Anything agreed in writing on your quotation or job order (a different payment term, delivery date or price) takes the place of the matching part of these terms for that order.',
      'Nothing here takes away the rights you have under the Consumer Act of the Philippines (Republic Act 7394) or any other law.',
    ],
  },
  {
    id: 'quotations', title: 'Quotations and design proofs',
    summary: 'A free quotation, valid for 15 days, and a design proof you approve before we make anything.',
    points: [
      'Quotations are free. Each one is valid for 15 days from its date unless it says otherwise. After that, prices and dates may change.',
      'Prices include VAT unless the quotation says otherwise. Ready-stock prices on this website are final.',
      'Before production we send a design proof (a mock-up) for you to check. Please check names, numbers, spelling, colours, logos and sizes carefully: we make exactly what you approve.',
      'Colours on a phone or computer screen can look slightly different from the finished fabric or print. Small differences in shade between dye lots and printing methods are normal and are not a defect.',
      'A design takes 2 to 4 days per proof. Changes after you approve the proof can add cost and move the delivery date.',
    ],
  },
  {
    id: 'payment', title: 'Orders, payment and downpayment',
    summary: 'A 50% downpayment starts your job order; the balance is paid before release.',
    points: [
      'A job order starts once you approve the design proof and pay the downpayment. Unless agreed otherwise, the downpayment is 50% of the order and the balance is paid in full before the order is released.',
      'Other terms (full payment, cash on delivery, or 7, 15 or 30 days\' credit) are for approved accounts only, and are written on the job order.',
      'We accept cash, GCash, bank transfer and checks. An order paid by check is released once the check has cleared. We issue a receipt for every payment.',
      'If your company withholds tax on its payments to us, please give us BIR Form 2307 for the amount withheld. The tax withheld counts as paid once we receive the form.',
      'The order total on your job order is the price you pay. Extra pieces, sizes, names or changes you ask for later are added at the quoted rates.',
    ],
  },
  {
    id: 'deposits', title: 'Layout fees and other deposits',
    summary: 'A deposit paid before a job order is credited to your order, or kept after 30 days.',
    points: [
      'Sometimes we ask for a deposit before a job order is made, for example a layout or design fee, or to reserve a production slot.',
      'If you go ahead with the order, the full deposit is credited to your job order.',
      'If you do not place the order within 30 days from the date you paid the deposit, the deposit is no longer refundable and is kept to cover the design work and the time reserved for you.',
    ],
  },
  {
    id: 'changes', title: 'Changes and cancellations',
    summary: 'Ask early: once cutting or printing starts, the work done is charged.',
    points: [
      'You may change or cancel an order free of charge until you approve the design proof.',
      'After you approve the proof, changes to designs, sizes or quantities are possible only for pieces not yet cut or printed, and may change the price and the delivery date.',
      'If you cancel or abandon an order after production has started, the downpayment is not refunded; it covers the materials bought and the work already done. Finished pieces can still be claimed once paid in full.',
      'An order not paid for and not claimed within 60 days after we tell you it is ready is treated as abandoned, and its downpayment is kept.',
    ],
  },
  {
    id: 'production', title: 'Production time and delivery',
    summary: 'Delivery dates count from your approval and downpayment.',
    points: [
      'Production times are counted in working days from the day you approve the proof and pay the downpayment. Typical times for each service are on our Services page; your quotation gives your own date.',
      'Rush orders are possible when our schedule allows, and may cost more.',
      'Late approvals, late payment, changes and late size lists move the delivery date by the same time.',
      'You may pick up your order at the shop, or have it delivered where we deliver. Delivery areas and fees are shown at checkout or on your quotation.',
      'We are not responsible for delays caused by events outside our control, such as typhoons, floods, power outages or courier problems, but we will tell you as soon as we know.',
    ],
  },
  {
    id: 'sizes', title: 'Sizes and fit',
    summary: 'We make the sizes on the list you confirm; check it before production.',
    points: [
      'We can bring or lend sizing sets, or take measurements per person. Each piece is made to the size on the list you confirm.',
      'Please check your size list before production. Pieces made to the confirmed list are not exchanged for another size, but we can alter or remake them for a fee.',
      'Small differences in finished measurements (about 1 inch or 2 cm) are normal for sewn garments.',
    ],
  },
  {
    id: 'release', title: 'Claiming your order',
    summary: 'Pay the balance, show a valid ID, and check your order before you leave.',
    points: [
      'Orders are released once paid in full (or as your agreed terms say). The person claiming shows a valid ID; we note who claimed it.',
      'Someone else may claim for you if you tell us beforehand who will come.',
      'Please count and check your order before leaving the shop or when the delivery arrives.',
      'Please claim your order within 30 days after we tell you it is ready. After that we may charge for storage, and the rule on abandoned orders above applies after 60 days.',
    ],
  },
  {
    id: 'online', title: 'Online shop orders',
    summary: 'Items are held for 24 hours while you pay by QR; we confirm once we see the payment.',
    points: [
      'When you place an order on this website, its pieces are held for you for 24 hours while you pay.',
      'Pay the exact amount by the QR code on your order page, then send the reference number and a screenshot there. We confirm your order once we see the payment in our account.',
      'If no payment arrives within 24 hours, the order expires and the pieces go back on sale. A late payment is accepted while every piece is still available; otherwise we refund it.',
      'If we cannot confirm a payment, or an item is no longer available, we tell you and refund what you paid for it.',
      'Keep the email with your order link: it is the only way to open your order page. You can also follow your order on the Track order page.',
    ],
  },
  {
    id: 'returns', title: 'Returns, exchanges and replacements',
    summary: 'Our mistakes are fixed free. Report problems within 7 days of receiving your order.',
    points: [
      'If a piece is defective or different from the approved proof or size list because of our error (a wrong print, spelling, size or colour, or a sewing defect), bring it back within 7 days of receiving it. After we check it, we repair or replace it free of charge, or refund it if we cannot.',
      'Made-to-order items made correctly to the approved proof and size list cannot be returned or refunded, because they are made for you. We can alter or remake them for a fee, which we tell you before we start.',
      'Ready-stock items (from the shop or this website) may be exchanged for another size or item within 7 days of purchase, if unworn, unwashed, with their tags, and with the receipt or order number, subject to stock. We do not give cash refunds for a change of mind.',
      'We do not cover damage from normal wear and tear, misuse, washing that goes against the care instructions, or alterations made elsewhere.',
      'To return an item, bring it to the shop with your receipt or order number, or contact us first and we will tell you where to send it. Every item brought back is checked, and we tell you whether it is fixed for free, for a fee, or declined, with the reason.',
    ],
  },
  {
    id: 'refunds', title: 'Refunds',
    summary: 'Paid back the way you paid, where we can.',
    points: [
      'When a refund is due, we pay it back by the way you paid where possible (GCash or bank transfer for online payments), within 7 working days after we agree on it.',
      'Delivery fees are refunded only when the return is because of our error.',
    ],
  },
  {
    id: 'artwork', title: 'Your designs and logos',
    summary: 'You confirm you may use the designs you send; we keep them for your re-orders only.',
    points: [
      'By sending us a logo, artwork, name or design, you confirm that you own it or have permission to use it. We may decline a design that we believe copies someone else\'s trademark or work.',
      'Your designs stay yours. We keep them on file only to make your re-orders and do not sell your design to others.',
      'Designs and patterns we create for you are made for your orders. Please ask us before having them produced elsewhere.',
    ],
  },
  {
    id: 'care', title: 'Caring for your garments',
    summary: 'Wash inside out in cold water so prints and colours last.',
    points: [
      'Wash printed and sublimated garments inside out in cold water, with mild detergent and no bleach.',
      'Do not iron directly on prints, patches or vinyl; dry in the shade.',
      'Embroidered items can be washed by hand or gently by machine; do not wring hard.',
    ],
  },
  {
    id: 'privacy', title: 'Your personal information',
    summary: 'We keep your details only to make, deliver and support your orders.',
    points: [
      'We keep your name, contact details, address, sizes and payment proofs to process your quotations and orders, as the Data Privacy Act of 2012 (Republic Act 10173) allows.',
      'We do not sell your information or use it for ads. We share it only with couriers and payment providers when needed for your order, or when the law requires it.',
      'This website counts visits without names, ads or cookies, and you can turn the counting off at the bottom of any page.',
      'While counting is on, your browser remembers the garments you looked at, to show you ones you may like. This stays on your device, is not sent to us, and is cleared when you turn counting off.',
      'To see, correct or remove your information, contact us at the email below.',
    ],
  },
  {
    id: 'updates', title: 'Changes to these terms and contact',
    summary: 'The terms in force on the day of your order apply to it.',
    points: [
      'We may update these terms. The date at the top shows the last change. An order follows the terms in force on the day it was placed or quoted.',
      'Questions about these terms or an order: email virtusgarment@gmail.com, call or text 0950 588 2663 (Sunday to Friday, 9 AM to 6 PM), or send a message on our Support page.',
    ],
  },
];
