export const INITIAL_WALLET_BONUS = 500;

export const ZY_COIN_PACKAGES = Object.freeze({
  zy100: Object.freeze({
    id: 'zy100',
    coins: 100,
    priceCents: 490,
    stripePriceId: 'price_1UDS0KQz853TlIRbSg7UJCAV',
    label: 'Pacote Inicial',
  }),
  zy500: Object.freeze({
    id: 'zy500',
    coins: 500,
    priceCents: 1490,
    stripePriceId: 'price_1UDS0QQz853TlIRbsyyxrgUN',
    label: 'Pacote Stream',
  }),
  zy1200: Object.freeze({
    id: 'zy1200',
    coins: 1200,
    priceCents: 2990,
    stripePriceId: 'price_1UDS0WQz853TlIRbS78FwjlX',
    label: 'Pacote Plus',
  }),
  zy2500: Object.freeze({
    id: 'zy2500',
    coins: 2500,
    priceCents: 4990,
    stripePriceId: 'price_1UDS0dQz853TlIRbS8tDl4iS',
    label: 'Pacote Ultra',
  }),
});

export function getCoinPackage(packageId) {
  if (typeof packageId !== 'string') return null;
  return ZY_COIN_PACKAGES[packageId] ?? null;
}
