/**
 * Lengths several modules must agree on.
 *
 * GARMENT_TYPE_MAX: a garment type, the name piece rates are kept under (for a made-to-order price list item, its name).
 * The price list, the import, the rate table and the production board all take up to this many letters, so a rate saved
 * on an item is always found when its pieces are recorded (the owner's decision, Oct 2026: 150; it was 60 on the board
 * and the rate table, which cut longer names and missed their rates).
 */
export const GARMENT_TYPE_MAX = 150;
