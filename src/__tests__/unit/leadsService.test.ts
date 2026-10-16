import { HttpError } from '../../lib/httpError';
import { createRateLimiter } from '../../lib/rateLimit';
import { isHoneypotTriggered, validateLead } from '../../services/leadsService';

const valid = {
  name: 'Ana Paula',
  phone: '(11) 98888-7777',
  salonName: 'Studio Bela Vista',
  teamSize: '2 a 3',
  consent: true,
};

describe('validateLead', () => {
  it('normaliza telefone, e-mail e UTM', () => {
    const lead = validateLead({
      ...valid,
      email: '  ANA@Exemplo.com ',
      utm: { utm_source: 'instagram', utm_campaign: 'out', hack: 'x', utm_x: '' },
    });

    expect(lead.phone).toBe('11988887777');
    expect(lead.email).toBe('ana@exemplo.com');
    expect(lead.source).toBe('landing');
    expect(lead.utm).toEqual({ utm_source: 'instagram', utm_campaign: 'out' });
  });

  it('aceita e-mail vazio como opcional', () => {
    expect(validateLead({ ...valid, email: '' }).email).toBeNull();
  });

  it('rejeita nome curto', () => {
    expect(() => validateLead({ ...valid, name: 'A' })).toThrow(HttpError);
  });

  it('rejeita telefone inválido', () => {
    expect(() => validateLead({ ...valid, phone: '1234' })).toThrow(/WhatsApp/);
  });

  it('rejeita e-mail malformado', () => {
    expect(() => validateLead({ ...valid, email: 'nao-e-email' })).toThrow(/E-mail/);
  });

  it('exige consentimento explícito', () => {
    expect(() => validateLead({ ...valid, consent: false })).toThrow(/autorizar/);
    expect(() => validateLead({ ...valid, consent: 'true' as unknown as boolean })).toThrow(HttpError);
  });

  it('lança 400 para payload nulo', () => {
    try {
      validateLead(null);
      fail('deveria lançar');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).statusCode).toBe(400);
    }
  });
});

describe('isHoneypotTriggered', () => {
  it('detecta campo oculto preenchido', () => {
    expect(isHoneypotTriggered({ ...valid, website: 'http://spam' })).toBe(true);
    expect(isHoneypotTriggered({ ...valid, website: '' })).toBe(false);
    expect(isHoneypotTriggered(valid)).toBe(false);
  });
});

describe('createRateLimiter', () => {
  it('bloqueia após o máximo dentro da janela', () => {
    const limiter = createRateLimiter({ max: 2, windowMs: 60_000 });
    expect(limiter.hit('ip').allowed).toBe(true);
    expect(limiter.hit('ip').allowed).toBe(true);
    const third = limiter.hit('ip');
    expect(third.allowed).toBe(false);
    expect(third.retryAfterSec).toBeGreaterThan(0);
    expect(limiter.hit('outro-ip').allowed).toBe(true);
  });

  it('libera depois que a janela expira', () => {
    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValue(1_000);
    const limiter = createRateLimiter({ max: 1, windowMs: 1_000 });
    expect(limiter.hit('ip').allowed).toBe(true);
    expect(limiter.hit('ip').allowed).toBe(false);
    nowSpy.mockReturnValue(2_500);
    expect(limiter.hit('ip').allowed).toBe(true);
    nowSpy.mockRestore();
  });
});
