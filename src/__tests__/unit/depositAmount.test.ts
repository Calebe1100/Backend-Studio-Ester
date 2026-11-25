import { depositAmountFromPrice } from '../../services/appointmentsService';

describe('depositAmountFromPrice', () => {
  it('calcula o percentual em centavos', () => {
    expect(depositAmountFromPrice(100, 30)).toBe(30);
    expect(depositAmountFromPrice(99.9, 30)).toBe(29.97);
  });

  it('não cobra sinal sem percentual ou sem preço', () => {
    expect(depositAmountFromPrice(100, 0)).toBeNull();
    expect(depositAmountFromPrice(null, 30)).toBeNull();
    expect(depositAmountFromPrice(undefined, 30)).toBeNull();
  });

  it('não cobra sinal zerado', () => {
    expect(depositAmountFromPrice(0, 30)).toBeNull();
  });
});
