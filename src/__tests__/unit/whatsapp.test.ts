import { toWhatsAppE164 } from '../../lib/whatsapp';

describe('toWhatsAppE164', () => {
  it('adiciona 55 em números BR com DDD', () => {
    expect(toWhatsAppE164('(11) 98888-7777')).toBe('5511988887777');
    expect(toWhatsAppE164('11988887777')).toBe('5511988887777');
  });

  it('mantém 55 se já presente', () => {
    expect(toWhatsAppE164('5511988887777')).toBe('5511988887777');
  });

  it('rejeita inválidos', () => {
    expect(toWhatsAppE164('123')).toBeNull();
    expect(toWhatsAppE164('')).toBeNull();
  });
});
