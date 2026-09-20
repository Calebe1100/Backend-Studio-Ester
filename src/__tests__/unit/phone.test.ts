import { isValidBrPhone, maskPhone, phoneLookupVariants, toE164 } from '../../lib/phone';

describe('isValidBrPhone', () => {
  it('aceita celular e fixo com DDD, com ou sem DDI', () => {
    expect(isValidBrPhone('(11) 98888-7777')).toBe(true);
    expect(isValidBrPhone('1138887777')).toBe(true);
    expect(isValidBrPhone('5511988887777')).toBe(true);
  });

  it('rejeita números incompletos', () => {
    expect(isValidBrPhone('98888777')).toBe(false);
    expect(isValidBrPhone('')).toBe(false);
  });
});

describe('phoneLookupVariants', () => {
  it('gera variantes com e sem DDI', () => {
    const variants = phoneLookupVariants('(11) 98888-7777');
    expect(variants).toContain('11988887777');
    expect(variants).toContain('5511988887777');
  });

  it('cobre celular salvo sem o nono dígito', () => {
    expect(phoneLookupVariants('11988887777')).toContain('1188887777');
    expect(phoneLookupVariants('1188887777')).toContain('11988887777');
  });

  it('não inventa nono dígito para telefone fixo', () => {
    expect(phoneLookupVariants('1133334444')).toEqual(['1133334444', '551133334444']);
  });

  it('devolve lista vazia sem dígitos', () => {
    expect(phoneLookupVariants('abc')).toEqual([]);
  });
});

describe('toE164', () => {
  it('formata com + para a Twilio', () => {
    expect(toE164('(11) 98888-7777')).toBe('+5511988887777');
    expect(toE164('123')).toBeNull();
  });
});

describe('maskPhone', () => {
  it('mantém apenas os 4 últimos dígitos', () => {
    expect(maskPhone('11988887777')).toBe('*******7777');
  });
});
